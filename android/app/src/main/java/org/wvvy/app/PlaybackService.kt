package org.wvvy.app

import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.cast.CastPlayer
import androidx.media3.cast.SessionAvailabilityListener
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.android.gms.cast.framework.CastContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

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

    // Now-playing metadata is polled here, inside the always-alive playback service,
    // rather than pushed from the webview plugin — the webview process is frozen or
    // gone once the app is backgrounded/swiped away, which is exactly when the lock
    // screen, notification and Android Auto would otherwise stick on the last song.
    // The station reports the current track over its AzuraCast API (not inline in
    // the Icecast stream), and the poll config rides on the MediaItem's request
    // metadata (see WvvyPlayerPlugin.load / the EXTRA_* keys below).
    private val mainHandler = Handler(Looper.getMainLooper())
    private val metadataExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private var metadataPoll: Runnable? = null
    private var lastMetadataKey: String? = null
    private val metadataIntervalMs = 15_000L

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
        currentPlayer.addListener(pollListener)
    }

    // Drive the metadata poll off the player's own state so it lives and dies with
    // playback wherever it happens (local or Cast), independent of the webview.
    private val pollListener =
        object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) startMetadataPolling()
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                // Only a true stop clears the poll; STATE_BUFFERING during a
                // reconnect must not, or the lock screen would freeze on every blip.
                if (playbackState == Player.STATE_IDLE || playbackState == Player.STATE_ENDED) {
                    stopMetadataPolling()
                }
            }

            override fun onMediaItemTransition(
                mediaItem: MediaItem?,
                reason: Int,
            ) {
                // A Cast handoff carries the item to a different player; re-read its
                // config extras and keep polling.
                if (mediaItem != null && currentPlayer.isPlaying) startMetadataPolling()
            }
        }

    // MARK: - Metadata polling

    private fun startMetadataPolling() {
        val extras = currentPlayer.currentMediaItem?.requestMetadata?.extras
        val nowPlayingUrl = extras?.getString(EXTRA_NOWPLAYING_URL)
        if (nowPlayingUrl.isNullOrEmpty()) return
        metadataPoll?.let { mainHandler.removeCallbacks(it) }
        val stationName = extras.getString(EXTRA_STATION_NAME) ?: ""
        val stationDesc = extras.getString(EXTRA_STATION_DESC) ?: ""
        val poll =
            object : Runnable {
                override fun run() {
                    fetchMetadata(nowPlayingUrl, stationName, stationDesc)
                    mainHandler.postDelayed(this, metadataIntervalMs)
                }
            }
        metadataPoll = poll
        mainHandler.post(poll) // fetch now, then every interval
    }

    private fun stopMetadataPolling() {
        metadataPoll?.let { mainHandler.removeCallbacks(it) }
        metadataPoll = null
        lastMetadataKey = null
    }

    private fun fetchMetadata(
        nowPlayingUrl: String,
        stationName: String,
        stationDesc: String,
    ) {
        metadataExecutor.execute {
            val song =
                try {
                    val conn =
                        (URL(nowPlayingUrl).openConnection() as HttpURLConnection).apply {
                            connectTimeout = 10_000
                            readTimeout = 10_000
                            setRequestProperty("Accept", "application/json")
                        }
                    val body = conn.inputStream.bufferedReader().use { it.readText() }
                    conn.disconnect()
                    JSONObject(body).optJSONObject("now_playing")?.optJSONObject("song")
                } catch (e: Exception) {
                    null
                } ?: return@execute

            fun field(key: String) = song.optString(key, "").trim()
            // Mirror the fallbacks the JS engine and the iOS poll apply, so the
            // transport reads identically whichever layer wrote it.
            val title = field("title").ifEmpty { "Live Stream" }
            val artist = field("artist").ifEmpty { stationName }
            val album = field("album").ifEmpty { stationDesc }
            val art = field("art")

            mainHandler.post { applyMetadata(title, artist, album, art) }
        }
    }

    private fun applyMetadata(
        title: String,
        artist: String,
        album: String,
        art: String,
    ) {
        // Skip the rebuild when the track hasn't actually moved.
        val key = "$artist|$title"
        if (key == lastMetadataKey) return
        val current = currentPlayer.currentMediaItem ?: return
        lastMetadataKey = key
        val metadata =
            MediaMetadata.Builder()
                .setTitle(title)
                .setArtist(artist)
                .setAlbumTitle(album)
                .apply { if (art.isNotEmpty()) setArtworkUri(Uri.parse(art)) }
                .build()
        // buildUpon() preserves the URI and the request metadata (the poll config),
        // so the extras survive across every metadata update.
        currentPlayer.replaceMediaItem(
            currentPlayer.currentMediaItemIndex,
            current.buildUpon().setMediaMetadata(metadata).build(),
        )
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

        previous.removeListener(pollListener)
        previous.stop()
        previous.clearMediaItems()

        if (item != null) {
            player.setMediaItem(item)
            player.prepare()
            player.playWhenReady = playWhenReady
        }

        currentPlayer = player
        player.addListener(pollListener)
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
        stopMetadataPolling()
        metadataExecutor.shutdownNow()
        currentPlayer.removeListener(pollListener)
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

    companion object {
        // Keys for the poll config carried on the MediaItem's request metadata,
        // set by WvvyPlayerPlugin.load from the JS engine (src/lib/playback/native.ts).
        const val EXTRA_NOWPLAYING_URL = "wvvy.nowPlayingUrl"
        const val EXTRA_STATION_NAME = "wvvy.stationName"
        const val EXTRA_STATION_DESC = "wvvy.stationDesc"
    }
}
