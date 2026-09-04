# Native audio: playback, volume, AirPlay, background, CarPlay, Android Auto

This is the part of the app most likely to be misunderstood, so it's written down
in full: what works today, how it's built, and what each remaining piece costs.
Most of iOS is now native; Android is still the webview.

## The architecture, and why

Playback sits behind the `PlaybackEngine` interface (`src/lib/playback/types.ts`).
The UI never touches an `<audio>` element — it calls `player.toggle()`, and the
store delegates to whichever engine `src/lib/playback/index.ts` installs:

- **iOS → `NativePlaybackEngine`** (`playback/native.ts`) — drives a native
  `AVPlayer` through the in-app `WvvyPlayer` Capacitor plugin.
- **Everything else → `WebPlaybackEngine`** (`playback/web.ts`) — `<audio>` plus
  the Media Session API. Web, PWA, and (for now) the Android webview.

Two reasons the boundary exists:

1. **`HTMLMediaElement.volume` is a silent no-op in WKWebView on iOS.** The web
   engine literally cannot offer a volume control there. `AVPlayer` volume works.
2. **CarPlay and Android Auto cannot see an `<audio>` element.** CarPlay renders
   native templates driven by `MPNowPlayingInfoCenter`; Android Auto reads a
   Media3 `MediaLibraryService`. Both need playback in native code. The iOS native
   engine is the surface CarPlay will attach to.

The reconnect/backoff/offline state machine lives in TypeScript in _both_ engines
(it's deliberately parallel, not shared, so the shipping web path carries no risk
from native changes). The native plugin is a dumb transport that reports
`playing` / `buffering` / `ended` / `error`; all recovery policy is in TS.

## What works right now

| Surface                              | Status | Notes                                              |
| ------------------------------------ | ------ | -------------------------------------------------- |
| Web / PWA playback                   | ✅     | `<audio>` + Media Session drives OS media keys     |
| iOS foreground playback              | ✅     | native `AVPlayer` (`WvvyPlayer` plugin)            |
| iOS background + lock screen         | ✅     | `UIBackgroundModes` + `AVAudioSession` — see below |
| iOS lock-screen artwork + track info | ✅     | `MPNowPlayingInfoCenter` from `updateNowPlaying()` |
| iOS in-app volume slider             | ✅     | native `MPVolumeView` overlay — see below          |
| iOS AirPlay button                   | ✅     | native `AVRoutePickerView` overlay — see below     |
| Bluetooth / car stereo over A2DP     | ✅     | track metadata rides along via AVRCP               |
| Android foreground playback          | ✅     | still the webview `<audio>` engine                 |
| Android background playback          | ⚠️     | works, but the OS may suspend it — see below       |
| CarPlay (native dashboard app)       | ❌     | needs Swift + an Apple entitlement                 |
| Android Auto (native dashboard app)  | ❌     | needs a Media3 service in Kotlin                   |

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

## Volume and AirPlay — the native-overlay plugin

The in-app volume slider and the AirPlay button are **native UIKit views overlaid
on the webview**, provided by an external plugin,
`capacitor-plugin-system-volume` (repo: `katamaengineering/`, published to npm;
`VolumeSlider` = `MPVolumeView`, `RoutePicker` = `AVRoutePickerView`).

Why native: WKWebView can neither read/set the OS output volume nor present the
AirPlay picker. Apple only exposes those through `MPVolumeView` and
`AVRoutePickerView`, which are views, not APIs. So the plugin mounts the real
Apple control over a transparent placeholder element (`<capacitor-volume-slider>`
/ `<capacitor-airplay-button>`), positioned from the element's
`getBoundingClientRect`.

Hard-won details, in case the overlays ever misbehave:

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

Because the overlays are pinned to their element's on-screen position, scrolling
the player page drags them around. So the Listen screen (`src/routes/+page.svelte`)
is a **fixed-height viewport** (`.fit-main` in `app.css` = `100dvh` minus the
insets `app-main` already pads by) with `overflow-hidden`. It never scrolls. It
has two views — a big-art player and an Apple-Music-style queue — and the queue's
recently-played list scrolls **inside its own region**, while the transport (play,
volume, AirPlay) stays pinned so the native overlays never move.

## The Android native engine (still to do)

Reliable Android background playback and Android Auto both need playback out of
the webview: a Media3 `ExoPlayer` inside a `MediaSessionService`, which also
supplies the foreground service. Then add an Android branch to
`NativePlaybackEngine`'s registration and `playback/index.ts`.

Android background today: audio from the WebView keeps playing when backgrounded,
but the process holds no foreground service, so Android may suspend or kill it
under memory pressure or aggressive OEM battery management (Samsung, Xiaomi,
OnePlus). `WAKE_LOCK` and `FOREGROUND_SERVICE_MEDIA_PLAYBACK` are declared but
nothing claims them yet. In practice: fine for a phone in hand, unreliable in a
pocket on a long drive. This is the strongest argument for the Android engine.

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

No entitlement, but Google Play reviews the Auto declaration separately. The
Media3 `MediaLibraryService` is the same component that fixes the
background-playback caveat, so do these two together.

## Verifying by hand (device only)

Automated tests can't observe any of this, and the simulator reproduces neither
the audio session nor `MPVolumeView`/`AVRoutePickerView`. On a real device:

1. Start playback, lock the screen → audio continues; lock-screen controls show
   the current track + artwork.
2. Background the app 60s → audio continues.
3. Pause from the lock screen → the in-app button reflects it.
4. Drag the in-app volume slider → loudness changes; press the hardware volume
   buttons → the on-screen slider tracks them (they're the same system volume).
5. Tap the AirPlay button → the system route picker opens; pick a speaker → audio
   routes there.
6. Cold-launch → the volume slider and AirPlay button land in place without a
   visible hop.
7. Connect Bluetooth → audio routes over; track metadata appears on the head unit.
8. Turn off Wi-Fi mid-stream → status shows "reconnecting…", then recovers.
