# Native audio: playback, volume, AirPlay, Chromecast, background, CarPlay, Android Auto

This is the part of the app most likely to be misunderstood, so it's written down
in full: what works today, how it's built, and what each remaining piece costs.
Both iOS and Android now run a real native audio engine; the webview `<audio>`
engine survives only for web and the installed PWA.

## The architecture, and why

Playback sits behind the `PlaybackEngine` interface (`src/lib/playback/types.ts`).
The UI never touches an `<audio>` element — it calls `player.toggle()`, and the
store delegates to whichever engine `src/lib/playback/index.ts` installs:

- **iOS and Android → `NativePlaybackEngine`** (`playback/native.ts`) — drives a
  native player through the in-app `WvvyPlayer` Capacitor plugin. iOS runs an
  `AVPlayer` (`ios/App/App/WvvyPlayer.swift`); Android runs a Media3 `ExoPlayer`
  inside a `MediaSessionService` (`android/.../PlaybackService.kt`). The plugin's
  JS surface is identical on both, so the same TypeScript engine drives them
  without a platform branch.
- **Everything else → `WebPlaybackEngine`** (`playback/web.ts`) — `<audio>` plus
  the Media Session API. Web and the installed PWA only.

Two reasons the boundary exists:

1. **`HTMLMediaElement.volume` is a silent no-op in WKWebView on iOS** (and is
   unreliable in the Android WebView). The web engine literally cannot offer a
   working volume control there. `AVPlayer` and `ExoPlayer` volume both work.
2. **CarPlay, Android Auto, Chromecast and reliable background playback cannot
   see an `<audio>` element.** They attach to a native media session —
   `MPNowPlayingInfoCenter` on iOS, a Media3 `MediaSession` on Android. Both need
   playback in native code.

The reconnect/backoff/offline state machine lives in TypeScript in _both_ engines
(it's deliberately parallel, not shared, so the shipping web path carries no risk
from native changes). Each native plugin is a dumb transport that reports
`playing` / `buffering` / `ended` / `error`; all recovery policy is in TS.

## What works right now

| Surface                             | iOS | Android | Notes                                                        |
| ----------------------------------- | --- | ------- | ------------------------------------------------------------ |
| Web / PWA playback                  | —   | —       | `<audio>` + Media Session drives OS media keys               |
| Native foreground playback          | ✅  | ✅      | AVPlayer / Media3 ExoPlayer via the `WvvyPlayer` plugin      |
| Background + lock screen            | ✅  | ✅      | see the per-platform notes below                             |
| Lock-screen artwork + track info    | ✅  | ✅      | `MPNowPlayingInfoCenter` / Media3 `MediaMetadata`            |
| Remote controls (play/pause/stop)   | ✅  | ✅      | fed back into `wantPlay` as the single source of truth       |
| In-app volume slider                | ✅  | ✅      | both drive OS volume via `capacitor-plugin-system-volume`    |
| Hardware volume-button sync         | ✅  | ✅      | both track the OS output volume                              |
| Bluetooth / car stereo over A2DP    | ✅  | ✅      | track metadata rides along (AVRCP / MediaSession)            |
| Cast to an external device          | ✅  | ✅      | iOS: AirPlay. Android: Chromecast — see below                |
| Adopt already-running playback      | ❌  | ✅      | Android's webview is recreated; iOS's persists — see below   |
| CarPlay (native dashboard app)      | ❌  | —       | needs an Apple entitlement — see below                       |
| Android Auto (native dashboard app) | —   | ⚠️      | the service is in place; the Auto declaration is not — below |

## The iOS native engine (`WvvyPlayer`)

An **in-app** Capacitor plugin (not a package), living in the committed native
project:

- `ios/App/App/WvvyPlayer.swift` — the `AVPlayer` wrapper. `play`/`stop`/
  `setVolume`, `MPNowPlayingInfoCenter` metadata + async artwork, and
  `MPRemoteCommandCenter` (play/pause/stop enabled; every scrub/skip disabled,
  since a live stream has no timeline). Reports state out via `timeControlStatus`
  KVO and the `AVPlayerItem` stall/fail/end notifications.
- `ios/App/App/WvvyPlayerPlugin.swift` — the `CAPPlugin` bridge.
- `src/lib/playback/native.ts` — `NativePlaybackEngine`, which keeps the reconnect
  logic and treats the plugin as transport.

### The registration gotcha (this cost hours)

An app-target plugin is **not** auto-registered in this SPM-based Capacitor
project, and the failure is silent — every JS call to the plugin rejects, so the
engine just loops "reconnecting".

- `bridge?.registerPluginType(_:)` is a **no-op when `autoRegisterPlugins` is
  true** (the default — plugins come from `capacitor.config.json`). Do not use it
  for an app-local plugin.
- Register the instance instead, from a `CAPBridgeViewController` subclass:
  `ios/App/App/MainViewController.swift` overrides `capacitorDidLoad()` and calls
  `bridge?.registerPluginInstance(WvvyPlayerPlugin())`. The storyboard's root view
  controller is pointed at `MainViewController` (custom class, target module).
- New Swift files must be added to `ios/App/App.xcodeproj/project.pbxproj` by hand
  (build-file, file-reference, group, and Sources-phase entries). The Xcode
  project is a classic group, not a synchronized folder, so files are not
  auto-included.

### iOS background audio — the two required pieces

Both are in place, and **neither works alone**:

1. `UIBackgroundModes: [audio]` in `ios/App/App/Info.plist`.
2. `AVAudioSession.setCategory(.playback, policy: .longFormAudio)` in
   `AppDelegate.configureAudioSession()`.

WKWebView (and an un-configured `AVAudioSession`) defaults to an _ambient_
session, which mutes the moment the app backgrounds. The plist key grants
permission to keep running; the session category is what keeps the audio alive.
The `AVPlayer` shares this session. A common failure mode is setting only the
plist key and concluding background audio "doesn't work in Capacitor".

## The Android native engine (`PlaybackService` + `WvvyPlayer`)

Android reaches the same JS surface as iOS through a different native shape,
because Android's reliable-background-audio primitive is a service, not an
in-process object:

- `android/.../PlaybackService.kt` — a Media3 `MediaSessionService` that owns the
  `ExoPlayer` and publishes a single `MediaSession`. That session draws the
  lock-screen / notification transport and is the surface Android Auto attaches
  to. **media3-session runs the foreground media notification itself** once
  playback starts — that's the whole reason to use `MediaSessionService` instead
  of a hand-rolled foreground service.
- `android/.../WvvyPlayerPlugin.kt` — the Capacitor plugin. It exposes the exact
  same methods and events as iOS (`load` / `stop` / `setVolume` /
  `updateNowPlaying` / `getState`, plus `stateChange` and `remoteCommand`) and
  connects to the service with a `MediaController`. A controller may only be
  touched on the thread it was built on, so every command is marshalled to the
  main executor — Capacitor runs `@PluginMethod` calls on a worker thread.
- `android/.../MainActivity.java` — unlike iOS, the plugin is registered
  explicitly with `registerPlugin(WvvyPlayerPlugin.class)`. `MainActivity` also
  requests the `POST_NOTIFICATIONS` runtime permission (Android 13+ needs it
  before a media notification can show).

### Android background audio

Reliable and in place. The `MediaSessionService` is a real foreground service
(`FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` in the manifest), and
the `ExoPlayer` is built with:

- `setWakeMode(C.WAKE_MODE_NETWORK)` — a network wake lock so the OS doesn't
  suspend the process mid-stream with the screen off.
- `handleAudioFocus = true` — duck/pause when a call or video takes focus, resume
  after, the behaviour a listener expects from radio.
- `setHandleAudioBecomingNoisy(true)` — pause when headphones are unplugged so the
  stream doesn't suddenly blast from the phone speaker.

`onTaskRemoved` stops the service if the app is swiped from recents while nothing
is playing (a live stream has no "resume", so holding the socket + notification
open would just leak), but leaves it running if audio is playing so the swipe
doesn't cut the music. This is what closes the old webview caveat where aggressive
OEM battery management (Samsung, Xiaomi, OnePlus) could kill a backgrounded
stream.

### Adopting an already-running stream (Android-only)

Background audio outlives the webview. On Android, closing and reopening the app
builds a **fresh webview** whose engine starts `idle` while the service may still
be streaming. So at startup the engine calls `WvvyPlayer.getState()` once and, if
the service is playing, adopts it — the UI shows "Stop" over live audio instead of
a "Play" button that would start a second load (`native.ts` `adoptRunningPlayback`,
gated to Android). iOS keeps its webview alive across backgrounding, so it needs
none of this and the iOS plugin has no `getState`; the guard and a try/catch make
that a no-op there.

## Casting — AirPlay (iOS) and Chromecast (Android)

Both platforms can send audio to an external device; each uses its own native
tech, and the mechanism differs.

**iOS — AirPlay.** The AirPlay button is a native `AVRoutePickerView`, supplied by
the same overlay plugin as the volume slider (see below). Routing is handled
entirely by the OS audio session; the app just presents the picker.

**Android — Chromecast.** `PlaybackService` holds a `CastPlayer` alongside the
local `ExoPlayer`, both behind the one `MediaSession`. A `SessionAvailabilityListener`
swaps which player the session points at when a Cast session comes and goes,
carrying the live item across — so the plugin, the JS engine and the lock screen
never know which device is actually playing. Configuration comes from
`CastOptionsProvider.kt` (Default Media Receiver), wired up via the
`OPTIONS_PROVIDER_CLASS_NAME` metadata in the manifest. Cast is **best-effort**: a
device without Google Play Services (some emulators, some regions) just plays
locally and never surfaces a cast button. The cast chooser is opened from the web
UI via the system-volume plugin's `openRoutePicker()`.

## Volume and casting UI — the system-volume plugin

Both platforms drive the **OS output volume** (not the player's own gain) through
one external plugin, `capacitor-plugin-system-volume` (repo: `katamaengineering/`,
published to npm), so the on-screen slider and the hardware buttons are always the
same volume. The native players run at full gain; nothing uses the app-gain path
on device. How the control is _drawn_ is where the two platforms differ.

**iOS — a native overlay.** WKWebView can neither read/set the OS output volume
nor present the AirPlay picker; Apple only exposes those through `MPVolumeView` and
`AVRoutePickerView`, which are views, not APIs. So the plugin mounts the real Apple
control over a transparent placeholder element (`<capacitor-volume-slider>` /
`<capacitor-airplay-button>`), positioned from the element's `getBoundingClientRect`.
`useNativeVolume` in `+page.svelte` gates this to iOS on device.

**Android — a styled web slider calling the plugin.** There's no native-overlay
equivalent, and none is needed: a normal styled slider calls
`CapacitorSystemVolume.setVolume`, a `volumeChange` listener keeps it in sync with
the hardware buttons, and the cast button calls the plugin's `openRoutePicker()`
to open the Chromecast chooser (the `isAndroidNative` branch in `+page.svelte`).

Hard-won details for the **iOS** overlays, in case they ever misbehave:

- **Mount as a direct top-level webview subview, _not_ inside WebKit's child
  scroll view.** The child-scroll-view trick (borrowed from native-map overlays)
  works for a map — which uses gesture recognizers — but a `UISlider` tracks
  touches directly, and the scroll view delays/cancels the drag or scrolls the
  slider out of view ("it disappears when you pull up on it"). A plain overlay
  gives the control a clean touch path.
- **Re-sync position after layout settles.** The first `getBoundingClientRect` can
  be measured before web fonts / `dvh`-sized boxes settle — shifts that move the
  element without changing its size (so a `ResizeObserver` misses them) and fire
  no scroll/resize event. The wrapper re-syncs on a few beats after create (next
  frame, `document.fonts.ready`, `window.load`, short timeouts).
- **`MPVolumeView` needs an active `AVAudioSession`** to reflect/set volume (we
  have one). Both it and `AVRoutePickerView` **render empty in the simulator** —
  device-only to test.

### Why the Listen screen is a fixed viewport

Because the iOS overlays are pinned to their element's on-screen position,
scrolling the player page drags them around. So the Listen screen
(`src/routes/+page.svelte`) is a **fixed-height viewport** (`.fit-main` in
`app.css` = `100dvh` minus the insets `app-main` already pads by) with
`overflow-hidden`. It never scrolls. It has two views — a big-art player and an
Apple-Music-style queue — and the queue's recently-played list scrolls **inside
its own region**, while the transport (play, volume, AirPlay/cast) stays pinned so
the native overlays never move.

## CarPlay — read before promising a date

CarPlay is **gated on Apple's approval, not on writing code**:

1. Request the CarPlay audio entitlement (<https://developer.apple.com/contact/carplay/>).
   Granted per app, discretionary, commonly weeks, can be refused.
2. Once granted, add `com.apple.developer.carplay-audio` to the entitlements file.
3. Implement `CPTemplateApplicationSceneDelegate` + a `CPNowPlayingTemplate` in
   Swift. It reads the same `MPNowPlayingInfoCenter` the native engine already
   populates, so for a single station this is a small surface — one now-playing
   screen and a play/stop command.

Until the entitlement is granted the app cannot appear on the CarPlay dashboard,
no matter what code exists. **Plan the entitlement request first.** And note:
listeners already get most of the benefit — over Bluetooth or USB the stream
plays through the car and the head unit shows title/artist. CarPlay adds an
in-dashboard app, not car listening itself.

## Android Auto

The hard part is done: `PlaybackService` is a `MediaSessionService`, exported with
the `androidx.media3.session.MediaSessionService` intent filter, which is exactly
what Android Auto binds to. What is **not** yet in place is the Auto app
declaration Google Play reviews separately — an `automotive_app_desc` resource
and the `com.google.android.gms.car.application` metadata — so the app is not yet
claimed as an Auto media app. Adding that declaration (and testing with the
Desktop Head Unit) is the remaining step; no entitlement, but a separate Play
review. As on iOS with Bluetooth, listeners already get car playback and head-unit
metadata over Bluetooth/USB without it.

## Verifying by hand (device only)

Automated tests can't observe any of this, and the simulator/emulator reproduces
neither the audio session nor `MPVolumeView`/`AVRoutePickerView`/Cast discovery.
On a real device:

1. Start playback, lock the screen → audio continues; lock-screen controls show
   the current track + artwork.
2. Background the app 60s → audio continues. On Android, swipe the app from
   recents while playing → audio keeps going; while paused → the notification
   clears and the service stops.
3. Pause from the lock screen / notification → the in-app button reflects it.
4. Drag the in-app volume slider → loudness changes; press the hardware volume
   buttons → the on-screen slider tracks them (they're the same system volume).
5. iOS: tap the AirPlay button → the system route picker opens; pick a speaker →
   audio routes there. Android: tap the cast button → the Cast chooser opens; pick
   a Chromecast → audio hands off, and the lock-screen transport keeps working.
6. Android: start playback, force-close and reopen the app → it shows "Stop" over
   the still-live audio, not "Play".
7. Cold-launch (iOS) → the volume slider and AirPlay button land in place without
   a visible hop.
8. Connect Bluetooth → audio routes over; track metadata appears on the head unit.
9. Turn off Wi-Fi mid-stream → status shows "reconnecting…", then recovers.
