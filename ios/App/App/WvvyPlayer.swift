import Foundation
import AVFoundation
import MediaPlayer
import UIKit

/// The native replacement for the WKWebView `<audio>` element.
///
/// Why it exists: `HTMLMediaElement.volume` is a silent no-op inside WKWebView on
/// iOS, so the in-app volume slider can't work from the web engine. `AVPlayer`'s
/// `volume` is a real per-app gain that works independent of the hardware ringer —
/// that's the whole reason we drop to native here. It also publishes to
/// `MPNowPlayingInfoCenter` / `MPRemoteCommandCenter`, the same native surface
/// CarPlay attaches to later.
///
/// Deliberately dumb: it starts/stops bytes, sets volume, and reports state and
/// remote commands back out. Every reconnect/backoff decision stays in TypeScript
/// (`NativePlaybackEngine`) so the web and native engines behave identically — see
/// `src/lib/playback/types.ts` for why that boundary exists.
final class WvvyPlayer: NSObject {
    enum State: String { case playing, buffering, ended, error }

    /// Playback state changed. `message` carries error text when relevant.
    var onState: ((State, String?) -> Void)?
    /// The listener hit a lock-screen / car / Bluetooth transport control.
    var onRemoteCommand: ((String) -> Void)?

    private var player: AVPlayer?
    private var item: AVPlayerItem?
    private var timeControlObs: NSKeyValueObservation?
    private var statusObs: NSKeyValueObservation?
    private var artworkTask: URLSessionDataTask?
    private var volume: Float = 0.85

    override init() {
        super.init()
        configureRemoteCommands()
    }

    // MARK: - Transport

    func play(urlString: String, volume: Float) {
        self.volume = volume
        guard let url = URL(string: urlString) else {
            onState?(.error, "invalid stream URL")
            return
        }
        teardownItem()

        let item = AVPlayerItem(url: url)
        self.item = item

        let player = self.player ?? AVPlayer()
        player.volume = volume
        player.replaceCurrentItem(with: item)
        self.player = player

        observe(player: player, item: item)
        registerItemNotifications(item)

        onState?(.buffering, nil)
        player.play()
        MPNowPlayingInfoCenter.default().playbackState = .playing
    }

    func stop() {
        teardownItem()
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        MPNowPlayingInfoCenter.default().playbackState = .stopped
    }

    func setVolume(_ v: Float) {
        volume = v
        player?.volume = v
    }

    // MARK: - Observation

    private func observe(player: AVPlayer, item: AVPlayerItem) {
        // `timeControlStatus` is the truest "is audio actually flowing" signal:
        // `.playing` means bytes are decoding, `.waitingToPlayAtSpecifiedRate`
        // means we're buffering or re-buffering.
        timeControlObs = player.observe(\.timeControlStatus, options: [.new]) { [weak self] p, _ in
            switch p.timeControlStatus {
            case .playing:
                self?.onState?(.playing, nil)
            case .waitingToPlayAtSpecifiedRate:
                self?.onState?(.buffering, nil)
            default:
                break
            }
        }
        statusObs = item.observe(\.status, options: [.new]) { [weak self] it, _ in
            if it.status == .failed {
                self?.onState?(.error, it.error?.localizedDescription)
            }
        }
    }

    private func registerItemNotifications(_ item: AVPlayerItem) {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(itemStalled),
                       name: AVPlayerItem.playbackStalledNotification, object: item)
        nc.addObserver(self, selector: #selector(itemFailed),
                       name: AVPlayerItem.failedToPlayToEndTimeNotification, object: item)
        nc.addObserver(self, selector: #selector(itemEnded),
                       name: AVPlayerItem.didPlayToEndTimeNotification, object: item)
    }

    // A live Icecast stream should never legitimately stall, fail, or "end" — any
    // of these is a dropped connection. Report it and let the TS engine's backoff
    // decide whether to reconnect.
    @objc private func itemStalled() { onState?(.error, "stream stalled") }
    @objc private func itemFailed() { onState?(.error, "stream failed") }
    @objc private func itemEnded() { onState?(.ended, nil) }

    private func teardownItem() {
        timeControlObs?.invalidate(); timeControlObs = nil
        statusObs?.invalidate(); statusObs = nil
        if let item = item {
            NotificationCenter.default.removeObserver(self, name: nil, object: item)
        }
        artworkTask?.cancel(); artworkTask = nil
        item = nil
    }

    // MARK: - Now Playing / lock-screen metadata

    func updateNowPlaying(title: String, artist: String, album: String, artworkUrl: String?) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: artist,
            MPMediaItemPropertyAlbumTitle: album,
            // No timeline: this is what keeps the scrubber off the lock screen.
            MPNowPlayingInfoPropertyIsLiveStream: true
        ]
        // Keep the current artwork visible while the new one downloads, so the
        // lock screen doesn't flash blank on every track change.
        if let existing = MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyArtwork] {
            info[MPMediaItemPropertyArtwork] = existing
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        loadArtwork(artworkUrl)
    }

    private func loadArtwork(_ urlString: String?) {
        artworkTask?.cancel()
        guard let s = urlString, let url = URL(string: s) else { return }
        let task = URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data = data, let image = UIImage(data: data) else { return }
            let art = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            DispatchQueue.main.async {
                var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                info[MPMediaItemPropertyArtwork] = art
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        }
        artworkTask = task
        task.resume()
    }

    private func configureRemoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in self?.onRemoteCommand?("play"); return .success }
        c.pauseCommand.addTarget { [weak self] _ in self?.onRemoteCommand?("pause"); return .success }
        c.stopCommand.addTarget { [weak self] _ in self?.onRemoteCommand?("stop"); return .success }
        // A live stream has no timeline, so keep every scrub/skip control off the
        // lock screen and car head unit — mirrors the web engine declining the
        // same Media Session actions.
        let disabled: [MPRemoteCommand] = [
            c.nextTrackCommand, c.previousTrackCommand, c.changePlaybackPositionCommand,
            c.skipForwardCommand, c.skipBackwardCommand, c.seekForwardCommand, c.seekBackwardCommand
        ]
        for cmd in disabled { cmd.isEnabled = false }
    }
}
