import Foundation
import Capacitor

/// Bridges the JS `NativePlaybackEngine` (`src/lib/playback/native.ts`) to the
/// native `WvvyPlayer`. Method metadata is declared through `CAPBridgedPlugin`, so
/// no Objective-C `CAP_PLUGIN` macro file is needed — Capacitor discovers this
/// plugin in the app bundle automatically at launch. (Android, by contrast, needs
/// an explicit `registerPlugin` in `MainActivity`.)
@objc(WvvyPlayerPlugin)
public class WvvyPlayerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WvvyPlayerPlugin"
    public let jsName = "WvvyPlayer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateNowPlaying", returnType: CAPPluginReturnPromise)
    ]

    private lazy var player: WvvyPlayer = {
        let p = WvvyPlayer()
        p.onState = { [weak self] state, message in
            self?.notifyListeners("stateChange", data: [
                "state": state.rawValue,
                "message": message ?? ""
            ])
        }
        p.onRemoteCommand = { [weak self] command in
            self?.notifyListeners("remoteCommand", data: ["command": command])
        }
        return p
    }()

    @objc func load(_ call: CAPPluginCall) {
        guard let url = call.getString("url") else {
            call.reject("url is required")
            return
        }
        let volume = Float(call.getDouble("volume") ?? 0.85)
        DispatchQueue.main.async {
            self.player.play(urlString: url, volume: volume)
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.player.stop()
            call.resolve()
        }
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        let volume = Float(call.getDouble("volume") ?? 0.85)
        DispatchQueue.main.async {
            self.player.setVolume(volume)
            call.resolve()
        }
    }

    @objc func updateNowPlaying(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.player.updateNowPlaying(
                title: call.getString("title") ?? "",
                artist: call.getString("artist") ?? "",
                album: call.getString("album") ?? "",
                artworkUrl: call.getString("artworkUrl")
            )
            call.resolve()
        }
    }
}
