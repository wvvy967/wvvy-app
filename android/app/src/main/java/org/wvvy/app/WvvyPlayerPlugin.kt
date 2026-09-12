package org.wvvy.app

import android.content.ComponentName
import android.net.Uri
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.common.util.concurrent.ListenableFuture

/**
 * Android side of the WvvyPlayer plugin — the exact surface iOS's
 * WvvyPlayerPlugin.swift exposes, so src/lib/playback/native.ts drives both
 * without change: load / stop / setVolume / updateNowPlaying, plus `stateChange`
 * and `remoteCommand` events. Playback itself lives in [PlaybackService]; this
 * connects to it with a MediaController and forwards commands and state.
 *
 * Threading: a MediaController may only be touched on the thread it was built on.
 * It's built here on the app main thread, and every command is marshalled back
 * there via the main executor — Capacitor runs @PluginMethod calls on a worker
 * thread, so calling the controller directly from one would crash.
 */
@CapacitorPlugin(name = "WvvyPlayer")
class WvvyPlayerPlugin : Plugin() {
    private var controller: MediaController? = null
    private var controllerFuture: ListenableFuture<MediaController>? = null

    override fun load() {
        val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
        val future = MediaController.Builder(context, token).buildAsync()
        controllerFuture = future
        future.addListener(
            {
                controller = future.get().also { it.addListener(playerListener) }
            },
            ContextCompat.getMainExecutor(context),
        )
    }

    private val playerListener =
        object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) = emitState()

            override fun onIsPlayingChanged(isPlaying: Boolean) = emitState()

            override fun onPlayerError(error: PlaybackException) {
                notifyListeners(
                    "stateChange",
                    JSObject().put("state", "error").put("message", error.message ?: "playback error"),
                )
            }

            // The user hit play/pause from the notification, lock screen, or a
            // headset button — tell JS so `wantPlay` stays the single source of
            // truth, exactly as the iOS remoteCommand path does. A live stream has
            // no pause, so a remote pause is treated as stop.
            override fun onPlayWhenReadyChanged(
                playWhenReady: Boolean,
                reason: Int,
            ) {
                if (reason != Player.PLAY_WHEN_READY_CHANGE_REASON_REMOTE) return
                val command = if (playWhenReady) "play" else "stop"
                notifyListeners("remoteCommand", JSObject().put("command", command))
            }
        }

    /** Map ExoPlayer state to the four the JS engine understands; skip the rest. */
    private fun emitState() {
        val c = controller ?: return
        val state =
            when {
                c.playerError != null -> "error"
                c.playbackState == Player.STATE_BUFFERING -> "buffering"
                c.playbackState == Player.STATE_ENDED -> "ended"
                c.playbackState == Player.STATE_READY && c.isPlaying -> "playing"
                // idle, or ready-but-paused: not a transition native.ts acts on.
                else -> return
            }
        notifyListeners("stateChange", JSObject().put("state", state))
    }

    @PluginMethod
    fun load(call: PluginCall) {
        val url = call.getString("url")
        if (url == null) {
            call.reject("url is required")
            return
        }
        val volume = call.getFloat("volume") ?: 0.85f
        onController(call) { c ->
            // A live stream has no timeline; a fresh item each attempt avoids
            // resuming a stale buffer, matching the web and iOS engines.
            c.setMediaItem(MediaItem.fromUri(url))
            c.volume = volume
            c.prepare()
            c.playWhenReady = true
            call.resolve()
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        onController(call) { c ->
            c.stop()
            c.clearMediaItems()
            call.resolve()
        }
    }

    @PluginMethod
    fun setVolume(call: PluginCall) {
        val volume = call.getFloat("volume") ?: 0.85f
        onController(call) { c ->
            // ExoPlayer's own gain (0..1), unlike WKWebView/Android-WebView
            // <audio>.volume which is a no-op — this is what makes the on-screen
            // slider actually move the volume on Android.
            c.volume = volume
            call.resolve()
        }
    }

    // Whether the background service is already streaming. The JS engine asks this
    // on startup so that reopening the app (a fresh webview) adopts a stream that's
    // still playing, instead of showing "Play" over live audio.
    @PluginMethod
    fun getState(call: PluginCall) {
        onController(call) { c ->
            val active =
                c.playWhenReady &&
                    c.playbackState != Player.STATE_IDLE &&
                    c.playbackState != Player.STATE_ENDED
            call.resolve(JSObject().put("playing", active))
        }
    }

    @PluginMethod
    fun updateNowPlaying(call: PluginCall) {
        val title = call.getString("title") ?: ""
        val artist = call.getString("artist") ?: ""
        val album = call.getString("album") ?: ""
        val artworkUrl = call.getString("artworkUrl")
        onController(call) { c ->
            val current = c.currentMediaItem
            if (current == null) {
                call.resolve()
                return@onController
            }
            val metadata =
                MediaMetadata.Builder()
                    .setTitle(title)
                    .setArtist(artist)
                    .setAlbumTitle(album)
                    .apply { if (artworkUrl != null) setArtworkUri(Uri.parse(artworkUrl)) }
                    .build()
            c.replaceMediaItem(
                c.currentMediaItemIndex,
                current.buildUpon().setMediaMetadata(metadata).build(),
            )
            call.resolve()
        }
    }

    /**
     * Run [block] against a connected controller on the main thread. If the
     * controller is still connecting, wait for it; if the connection fails, reject.
     */
    private fun onController(
        call: PluginCall,
        block: (MediaController) -> Unit,
    ) {
        val executor = ContextCompat.getMainExecutor(context)
        val connected = controller
        if (connected != null) {
            executor.execute { block(connected) }
            return
        }
        val future = controllerFuture
        if (future == null) {
            call.reject("player service not initialized")
            return
        }
        future.addListener(
            {
                val ready =
                    try {
                        future.get()
                    } catch (e: Exception) {
                        call.reject("could not connect to the player service", e)
                        return@addListener
                    }
                block(ready)
            },
            executor,
        )
    }

    override fun handleOnDestroy() {
        controller?.removeListener(playerListener)
        controllerFuture?.let { MediaController.releaseFuture(it) }
        controller = null
        controllerFuture = null
    }
}
