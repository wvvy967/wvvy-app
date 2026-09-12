package org.wvvy.app

import android.content.Intent
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.cast.CastPlayer
import androidx.media3.cast.SessionAvailabilityListener
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.android.gms.cast.framework.CastContext

/**
 * The background home of the Android audio engine — the counterpart to iOS's
 * AVPlayer living inside the app process. It owns the players and publishes a
 * [MediaSession], which draws the lock-screen / notification transport controls
 * and is the surface Android Auto attaches to. `WvvyPlayerPlugin` connects with a
 * `MediaController` and drives it from the webview, so the JS `NativePlaybackEngine`
 * (src/lib/playback/native.ts) talks to the same interface it already uses on iOS.
 *
 * Casting is transparent to everything above: a [CastPlayer] and the local
 * [ExoPlayer] sit behind the one MediaSession, and [setCurrentPlayer] swaps which
 * one the session points at when a Cast session comes and goes — carrying the live
 * item across — so the plugin, the JS engine and the lock screen never know which
 * device is actually playing.
 *
 * media3-session manages the foreground media notification itself once playback
 * starts, which is the whole reason to use a MediaSessionService rather than a
 * hand-rolled foreground service.
 */
class PlaybackService : MediaSessionService() {
    private lateinit var exoPlayer: ExoPlayer
    private var castPlayer: CastPlayer? = null
    private lateinit var currentPlayer: Player
    private var mediaSession: MediaSession? = null

    override fun onCreate() {
        super.onCreate()

        exoPlayer =
            ExoPlayer.Builder(this)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                        .setUsage(C.USAGE_MEDIA)
                        .build(),
                    // Duck/pause when another app takes focus (a call, a video),
                    // resume after — the behaviour a listener expects from radio.
                    /* handleAudioFocus = */ true,
                )
                // Pause when the headphones are unplugged, so the stream doesn't
                // suddenly play out loud from the phone speaker.
                .setHandleAudioBecomingNoisy(true)
                // Hold a network wake lock while playing so the OS doesn't suspend
                // the process mid-stream with the screen off.
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .build()

        // Cast is best-effort: a device without Google Play Services (some
        // emulators, some regions) simply plays locally. Never let its absence
        // take down audio playback.
        castPlayer =
            try {
                val castContext = CastContext.getSharedInstance(this)
                CastPlayer(castContext).apply {
                    setSessionAvailabilityListener(
                        object : SessionAvailabilityListener {
                            override fun onCastSessionAvailable() = setCurrentPlayer(this@apply)

                            override fun onCastSessionUnavailable() = setCurrentPlayer(exoPlayer)
                        },
                    )
                }
            } catch (e: Exception) {
                null
            }

        // Start on whichever is already active — a Cast session can already be up
        // when the service spins up.
        currentPlayer = if (castPlayer?.isCastSessionAvailable == true) castPlayer!! else exoPlayer
        mediaSession = MediaSession.Builder(this, currentPlayer).build()
    }

    /**
     * Point the session at [player], moving the live item and play intent across
     * from whatever was playing. This is the whole cast handoff: the plugin keeps
     * driving the session, and the commands land on the device now behind it.
     */
    private fun setCurrentPlayer(player: Player) {
        if (player === currentPlayer) return
        val previous = currentPlayer
        val item = previous.currentMediaItem
        val playWhenReady = previous.playWhenReady

        previous.stop()
        previous.clearMediaItems()

        if (item != null) {
            player.setMediaItem(item)
            player.prepare()
            player.playWhenReady = playWhenReady
        }

        currentPlayer = player
        mediaSession?.player = player
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    /*
      A live radio stream has no "resume where you left off". If the app is swiped
      away from recents while nothing is playing, keeping the service (and its
      socket + notification) alive is just a leak — stop outright. If audio IS
      playing, leave it running so swiping the app away doesn't cut the music.
    */
    override fun onTaskRemoved(rootIntent: Intent?) {
        if (!currentPlayer.playWhenReady || currentPlayer.mediaItemCount == 0) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        mediaSession?.run {
            release()
        }
        mediaSession = null
        castPlayer?.setSessionAvailabilityListener(null)
        castPlayer?.release()
        castPlayer = null
        exoPlayer.release()
        super.onDestroy()
    }
}
