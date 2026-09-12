package org.wvvy.app

import android.content.Context
import com.google.android.gms.cast.framework.CastOptions
import com.google.android.gms.cast.framework.OptionsProvider
import com.google.android.gms.cast.framework.SessionProvider
import com.google.android.gms.cast.framework.media.CastMediaOptions

/**
 * Cast SDK configuration, found via the manifest meta-data
 * `OPTIONS_PROVIDER_CLASS_NAME`. A live audio stream needs no custom receiver, so
 * this uses Google's Default Media Receiver.
 *
 * The notification/media-session UI is disabled here because our own
 * [PlaybackService] already publishes a MediaSession — letting the Cast SDK post
 * a second one would show two competing notifications.
 */
class CastOptionsProvider : OptionsProvider {
    override fun getCastOptions(context: Context): CastOptions {
        val mediaOptions =
            CastMediaOptions.Builder()
                .setMediaSessionEnabled(false)
                .setNotificationOptions(null)
                .build()
        return CastOptions.Builder()
            // The Default Media Receiver app id — plays plain audio/video URLs
            // with no receiver app of our own to host.
            .setReceiverApplicationId("CC1AD845")
            .setCastMediaOptions(mediaOptions)
            .build()
    }

    override fun getAdditionalSessionProviders(context: Context): List<SessionProvider>? = null
}
