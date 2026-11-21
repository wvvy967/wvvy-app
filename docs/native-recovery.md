# Native recovery: making playback outlive the webview

Status: **design / proposed.** Nothing here is built yet. This doc is the plan for
closing one architectural gap in the native audio engine; the shipped behaviour is
described in [native-audio.md](native-audio.md), which this builds on.

## The gap

Native playback exists so audio can keep running when the webview can't — locked,
backgrounded, or (on Android) swiped away entirely. But today **all recovery and
part of the transport control still live in the webview**, so the one situation
native playback is for is the one situation recovery doesn't survive.

The reconnect/backoff state machine is in TypeScript, in `NativePlaybackEngine`
([`src/lib/playback/native.ts`](../src/lib/playback/native.ts)). The native players
are deliberately dumb transports: they report `playing` / `buffering` / `ended` /
`error` and nothing else. That boundary is intentional and documented — it keeps
the native and web engines behaving identically and keeps the shipping web path
free of native risk. It also assumes the JS engine is always executable. In the
background it frequently isn't:

- **iOS — the sharp edge.** The app process survives backgrounding under the
  `audio` mode, but WKWebView's JS timers are **suspended**. (This is already why
  metadata polling was moved native — see
  [`WvvyPlayer.swift:34`](../ios/App/App/WvvyPlayer.swift).) So when a live stream
  drops, `itemStalled` / `itemFailed` / `itemEnded`
  ([`WvvyPlayer.swift:133`](../ios/App/App/WvvyPlayer.swift)) emit `error`/`ended`
  to JS, `handleDrop()` schedules `setTimeout(start, delay)`
  ([`native.ts:196`](../src/lib/playback/native.ts)) — **and that timer never fires
  while backgrounded.** The stream drops in your pocket and does not come back
  until you reopen the app. Lock-screen play/pause has the same flaw: the remote
  command round-trips through JS
  ([`WvvyPlayer.swift:245`](../ios/App/App/WvvyPlayer.swift) →
  [`native.ts:149`](../src/lib/playback/native.ts)) that may be frozen.

- **Android — the clear-cut gap.** The `MediaSessionService` correctly outlives the
  activity ([`PlaybackService.kt:254`](../android/app/src/main/java/org/wvvy/app/PlaybackService.kt)),
  so audio keeps playing after the app is swiped away. But the only `onPlayerError`
  handler lives in the **plugin**
  ([`WvvyPlayerPlugin.kt:55`](../android/app/src/main/java/org/wvvy/app/WvvyPlayerPlugin.kt)),
  which runs in the webview process and is gone once the app is removed. The
  always-alive **service** has no error handler at all — its `pollListener`
  ([`PlaybackService.kt:111`](../android/app/src/main/java/org/wvvy/app/PlaybackService.kt))
  only watches play/stop/transition, never error. A terminal ExoPlayer error with
  the webview gone has **no reconnect path**. (Android's lock-screen transport is
  fine: the `MediaSession` actuates the player directly, so play/pause/stop work
  without the webview — the plugin's `remoteCommand` event is only a UI mirror.)

So the two platforms fail differently. iOS has **two** gaps — recovery and remote
transport both route through suspendable JS. Android has **one** — error-driven
reconnect is the only thing that needed the webview, and it's missing from the
service.

## The design: move policy down, make JS a mirror

Invert the boundary for the native engines only:

| Responsibility | Today | Proposed |
| --- | --- | --- |
| User intent (tap play/stop in the app) | JS → plugin | JS → plugin (unchanged) |
| Reconnect / backoff policy | **JS** | **Native** (per platform) |
| Remote transport actuation (lock screen/car) | iOS: JS · Android: session | Native (both) |
| "Should audio be playing" (`wantPlay`) | JS owns | **Native owns**, mirrored to JS |
| UI state (status, error, playing) | JS owns | Native emits → **JS mirrors** |

After this, `NativePlaybackEngine` still receives the user's taps and forwards them
as intent, but it no longer runs a retry loop or decides when playback has failed.
It reflects what the native layer reports. The native layer becomes the single
source of truth for whether the stream should be up and keeps it up on its own
clock, which keeps running in the background.

**The web engine does not change.** `WebPlaybackEngine`
([`src/lib/playback/web.ts`](../src/lib/playback/web.ts)) keeps its own parallel
reconnect machine. The two were deliberately kept separate, not shared, so the
shipping web path carries no risk from native changes — that stays true here. Only
`native.ts` loses its retry loop.

## iOS

Add a reconnect state machine to `WvvyPlayer`
([`WvvyPlayer.swift`](../ios/App/App/WvvyPlayer.swift)). The engine already holds
everything it needs to reload without JS (stream URL, volume, station labels); it
just needs to retain the URL and act on a timer instead of asking JS to.

- **Retain the load parameters** (`streamUrlString`, `volume`, and the existing
  metadata config) so a reconnect can rebuild the `AVPlayerItem` with a fresh URL,
  matching the "fresh item each attempt" rule the JS engine uses
  ([`native.ts:202`](../src/lib/playback/native.ts)).
- **Own `wantPlay`** as a `Bool` on the player. `play(...)` sets it; `stop()` clears
  it. A terminal event while `wantPlay` is true triggers reconnect; while false it
  settles to idle.
- **Backoff on a `DispatchSourceTimer`** — this is the crux. A dispatch timer on a
  background-eligible queue **keeps firing under the `audio` background mode**,
  exactly where the JS `setTimeout` can't. Same budget as the JS engine: 6 attempts
  at `min(2^n, 10)` seconds — 1, 2, 4, 8, 10, 10 ≈ 35s — then give up.
- **Reset** `reconnectAttempts` to 0 on `timeControlStatus == .playing`.
- **On exhaustion**, set `wantPlay = false` and emit `error` with the existing
  "off air" message.
- **Remote commands actuate directly.** `playCommand` → if `!wantPlay`, start from
  the retained URL. `pauseCommand` / `stopCommand` → `stop()`. Each still emits a
  state change outward so the JS mirror updates; the `onRemoteCommand → JS` control
  path is retired.

## Android

The service is already the always-alive owner; it's just missing one listener. Add
error-driven recovery to `PlaybackService`
([`PlaybackService.kt`](../android/app/src/main/java/org/wvvy/app/PlaybackService.kt)),
not the plugin.

- **Add `onPlayerError(PlaybackException)`** to a listener on `currentPlayer` (the
  `pollListener` can carry it, or a dedicated listener). ExoPlayer does **not**
  auto-retry a fatal source error, so this is the recovery.
- **Backoff via `mainHandler.postDelayed`**, same budget as iOS/JS. Recovery is
  `player.prepare()` again (it retains the media item + the poll-config extras), or
  re-set the item and prepare — either re-opens the socket on a fresh connection.
- **Reset** attempts on `onIsPlayingChanged(true)`.
- **On exhaustion**, stop and let the session reflect the stopped/error state so the
  notification doesn't sit on a dead stream.
- Must survive a **Cast handoff**: `setCurrentPlayer`
  ([`PlaybackService.kt:225`](../android/app/src/main/java/org/wvvy/app/PlaybackService.kt))
  moves the listener across already; the reconnect state should reset on handoff so
  a local drop mid-cast doesn't fight the `CastPlayer`.
- The plugin's existing `onPlayerError → JS`
  ([`WvvyPlayerPlugin.kt:55`](../android/app/src/main/java/org/wvvy/app/WvvyPlayerPlugin.kt))
  stays, but demoted to a **UI mirror** — the service, not the webview, now does the
  recovering.

## The JS side (`NativePlaybackEngine`) and the plugin surface

- **Remove** `handleDrop`, `reconnectTimer`, `reconnectAttempts`, and the
  `start()` retry wrapper from [`native.ts`](../src/lib/playback/native.ts). The
  online/offline handlers that kick a reconnect
  ([`native.ts:156`](../src/lib/playback/native.ts)) also go — the native layer
  watches its own connectivity now.
- `play()` / `stop()` become thin intent forwarders to `load` / `stop`.
- **State is driven by events, not computed locally.** Let the native `stateChange`
  payload carry the authoritative `wantPlay` and a `status` the engine maps straight
  onto `PlaybackState`, so a native-initiated stop (backoff exhausted, remote stop)
  reaches the UI toggle. Add a `reconnecting` case to the plugin's state enum
  (today `playing`/`buffering`/`ended`/`error` —
  [`native.ts:31`](../src/lib/playback/native.ts),
  [`WvvyPlayer.swift:20`](../ios/App/App/WvvyPlayer.swift)) so the UI can show
  "reconnecting…" from a native signal rather than inferring it.
- `adoptRunningPlayback` ([`native.ts:89`](../src/lib/playback/native.ts)) stays and
  gets simpler — adopting native-owned state is now the normal path, not a special
  case, and it should adopt a `reconnecting` stream too, not just a playing one.

This is the biggest edit of the three and the one that can regress the foreground
experience, so it lands last (see sequencing).

## What explicitly does not change

- `WebPlaybackEngine` and its reconnect machine — untouched, risk-isolated.
- The native **metadata** polling on both platforms — already native, already
  correct, independent of this.
- Volume / AirPlay / Cast / the system-volume plugin — orthogonal.
- The plugin **method** surface (`load`/`stop`/`setVolume`/`updateNowPlaying`/
  `getState`). Only the **event** payloads grow (`reconnecting`, `wantPlay`).

## Validation — device only

None of this is observable in the simulator/emulator or in automated tests: the
background suspension, the audio session, and a real network drop are all
device-only. The core sequence the finding calls for, per platform:

1. Play on a real device; confirm foreground reconnect still works (toggle Wi-Fi
   off/on with the app open → `reconnecting…` → recovers). **Regression check** —
   this must keep working after JS loses its retry loop.
2. Play, lock the screen, **background the app** (Android: also swipe it from
   recents). Then **interrupt the network** (airplane mode, or kill the AP) and hold
   past the ~35s budget-worth of drops **without reopening the app**.
3. **Restore** the network. Audio must come back **on its own**, app still
   backgrounded/closed. This is the behaviour that's broken today.
4. **Lock-screen controls with the app never reopened:** pause, then play — both
   must actuate (iOS is the one that currently round-trips to JS).
5. Let the network stay down past the full budget → playback gives up cleanly, the
   lock screen/notification reflects stopped, and reopening the app shows the same
   (not a spinner, not "Play" over dead air).
6. Android handoff: start a Cast session, drop the **local** network mid-cast →
   Cast playback is unaffected; end the Cast session → local recovery behaves.

Steps 2–5 are exactly where the current build fails, so they are the acceptance
test, not a nicety. When this ships, fold them into the by-hand list in
[native-audio.md](native-audio.md) (its step 9 only covers the foreground case).

## Suggested sequencing

Smallest-risk first; each step is shippable and independently testable on a device:

1. **Android `onPlayerError` recovery in the service.** Self-contained, webview-
   independent, doesn't touch the JS boundary. Closes the clear-cut gap and is the
   lowest-risk win.
2. **iOS reconnect loop + direct remote commands in `WvvyPlayer`.** Native-only
   change; JS still works as-is because native keeps emitting the same events.
3. **Rework `NativePlaybackEngine` into a mirror** and add the `reconnecting` /
   `wantPlay` payload. Do this last: it's the edit that can regress the foreground
   path, and by now both native sides are already authoritative, so JS is only
   catching up to them.
