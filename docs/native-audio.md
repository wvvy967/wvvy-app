# Background audio, lock screen, CarPlay, Android Auto

This is the part of the app most likely to be misunderstood, so it's written down
in full: what works today, what doesn't, and what each remaining piece costs.

## The architecture, and why

Playback sits behind the `PlaybackEngine` interface (`src/lib/playback/types.ts`).
The UI never touches an `<audio>` element — it calls `player.toggle()`, and the
store delegates to whichever engine is installed.

That indirection exists for one reason: **CarPlay and Android Auto cannot see an
HTML `<audio>` element.** CarPlay renders native templates driven by
`MPNowPlayingInfoCenter`; Android Auto reads a Media3 `MediaLibraryService`.
Neither can be driven from a webview. If playback lived directly in the UI,
adding car support later would mean rewriting the player. Behind the interface,
it's an additive change.

Today there is one implementation, `WebPlaybackEngine` — `<audio>` plus the Media
Session API.

## What works right now

| Surface                              | Status | Notes                                        |
| ------------------------------------ | ------ | -------------------------------------------- |
| Web / PWA playback                   | ✅     | Media Session drives OS media keys           |
| iOS foreground playback              | ✅     |                                              |
| iOS background + lock screen         | ✅     | Requires both changes described below        |
| iOS lock-screen artwork + track info | ✅     | Published from `updateMetadata()`            |
| Bluetooth / car stereo over A2DP     | ✅     | Track metadata rides along via AVRCP         |
| Android foreground playback          | ✅     |                                              |
| Android background playback          | ⚠️     | Works, but the OS may suspend it — see below |
| CarPlay (native dashboard app)       | ❌     | Needs native work + an Apple entitlement     |
| Android Auto (native dashboard app)  | ❌     | Needs a Media3 service in Kotlin             |

### iOS background audio — the two required pieces

Both are already in place, and **neither works alone**:

1. `UIBackgroundModes: [audio]` in `ios/App/App/Info.plist`
2. `AVAudioSession.setCategory(.playback, policy: .longFormAudio)` in
   `AppDelegate.configureAudioSession()`

WKWebView defaults to an _ambient_ audio session, which mutes the moment the app
backgrounds. The plist key grants permission to keep running; the session
category is what actually keeps the audio alive. A common failure mode is setting
only the plist key and concluding background audio "doesn't work in Capacitor".

### Android background audio — the caveat

Audio from a WebView keeps playing when backgrounded, but the process holds no
foreground service, so Android is free to suspend or kill it under memory
pressure or aggressive OEM battery management (Samsung, Xiaomi, and OnePlus are
the usual offenders). The `WAKE_LOCK` and `FOREGROUND_SERVICE_MEDIA_PLAYBACK`
permissions are already declared, but **nothing claims them yet** — that requires
the native engine below.

In practice: fine for a phone in hand, unreliable for a phone in a pocket on a
long drive. This is the strongest argument for doing the native engine.

## The native engine (unlocks CarPlay + Android Auto)

The remaining work is a Capacitor plugin that moves playback out of the webview:

- **iOS** — `AVPlayer` behind a `CAP_PLUGIN`, publishing to
  `MPNowPlayingInfoCenter` and handling `MPRemoteCommandCenter`.
- **Android** — Media3 `ExoPlayer` inside a `MediaSessionService`, which also
  supplies the foreground service Android background playback needs.

Then add `NativePlaybackEngine implements PlaybackEngine` and branch in
`src/lib/playback/index.ts` on `Capacitor.isNativePlatform()`. Nothing else in
the app changes — that's the payoff for the interface.

### CarPlay specifically — read before promising a date

CarPlay support is **gated on Apple's approval, not on writing code**:

1. Request the CarPlay audio entitlement from Apple
   (<https://developer.apple.com/contact/carplay/>). Apple grants it per app, and
   the review is discretionary. Approval commonly takes weeks and can be refused.
2. Once granted, add `com.apple.developer.carplay-audio` to the entitlements file.
3. Implement `CPTemplateApplicationSceneDelegate` and a `CPNowPlayingTemplate`
   in Swift. For a single-station app this is a small surface — essentially one
   now-playing screen and a play/stop command.

Until the entitlement is granted the app cannot appear on the CarPlay dashboard
at all, no matter what code exists. **Plan the entitlement request first** — it's
the long pole, and the Swift work is comparatively minor.

Worth noting: listeners already get most of the practical benefit today. With a
phone connected over Bluetooth or USB, the stream plays through the car speakers
and the head unit shows the track title and artist. CarPlay adds a proper
in-dashboard app rather than enabling car listening for the first time.

### Android Auto

No entitlement — but Google Play reviews the Auto declaration separately before
the app is distributed to cars. The Media3 `MediaLibraryService` is the same
component that fixes the background-playback caveat above, so these two are worth
doing together.

## Verifying background audio by hand

Automated tests can't observe any of this. On a real device (the simulator does
not reproduce audio-session behaviour):

1. Start playback, lock the screen → audio continues, controls show on the lock
   screen with the current track and artwork.
2. Background the app, wait 60 seconds → audio continues.
3. Pause from the lock screen → the in-app button reflects it (the Media Session
   handler calls back into the engine).
4. Connect Bluetooth → audio routes over, track metadata appears on the head unit.
5. Turn off Wi-Fi mid-stream → status shows "reconnecting…", then recovers when
   the network returns.
