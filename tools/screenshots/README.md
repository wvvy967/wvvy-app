# Store screenshots

Regenerates the App Store and Play Store screenshot sets from the iOS Simulator
and the Android emulator.

```bash
npm run screenshots                                  # every target, both platforms
npm run screenshots:ios                              # both Apple sizes
npm run screenshots:android                          # both Play sizes
node tools/screenshots/capture.mjs iphone-6.9        # one size
node tools/screenshots/capture.mjs play-phone --no-build --scenes=player
```

Output lands in `store/screenshots/` (gitignored — regenerating is cheap and each
store keeps whatever was uploaded).

## What it captures

Four screens, in upload order, across four device targets:

| Set              | Device / size                     | Where it goes                    |
| ---------------- | --------------------------------- | -------------------------------- |
| `iphone-6.9`     | iPhone 17 Pro Max · 1320 × 2868   | App Store, iPhone (required)     |
| `ipad-13`        | iPad Pro 13-inch (M5) · 2064 × 2752 | App Store, iPad (required¹)    |
| `play-phone`     | emulator resized · 1080 × 1920    | Play, phone (required)           |
| `play-tablet-10` | emulator resized · 1600 × 2560    | Play, 10" tablet (optional²)     |

- `01-player.png` — the Listen screen: cover art, now playing, transport, volume.
- `02-schedule.png` — the weekly schedule, today first.
- `03-support.png` — ways to give.
- `04-about.png` — station info.

¹ Required because the app ships for iPhone + iPad. ² Play only requires phone
screenshots; the tablet set is the same emulator resized (WVVY's layout is pure
CSS width), so it costs nothing to keep — drop it if the tablet render looks off.

## How it works

Two files. `harness.js` runs **inside** the app; `capture.mjs` drives the device
from outside. Read `harness.js` first. Both are adapted from na-meetings-near-me,
without its map or state seeding (WVVY shows live data — real now-playing, the
real schedule sheet).

The app is a webview, so the harness walks it to each screen by clicking its own
controls (`nav a`, by index), not a coordinate. The two platforms reach a screen
differently:

- **iOS** has no debugging protocol to attach to, so the driver bakes the scene
  name into the page by rewriting `index.html` **inside the installed app
  bundle** (the simulator doesn't verify bundle signatures — no rebuild, no
  Xcode) and relaunches; the page walks itself to the screen.
- **Android** has one, so nothing is rewritten: the harness is registered with
  `Page.addScriptToEvaluateOnNewDocument` (Chrome DevTools Protocol over `adb`,
  no dependency) and each screen is an awaited `window.__shot.run(scene)`. Needs
  a **debug** build — that's what exposes the debuggable webview.

**A shot is taken once two consecutive screenshots are byte-identical.** On iOS
that only counts after two that *differed* first — while a scene runs, the harness
animates a small square in the corner, so a page mid-scene can never look settled;
the square is removed before the screen goes still. Android awaits the scene over
the protocol before sampling, so the marker is already gone and movement isn't
required. This is also what waits out the live cover art and the schedule's
Google-sheet fetch, which have no clean DOM signal.

## Shot mode

The harness sets `localStorage['wvvy:shot'] = '1'` before the app boots. The only
thing it changes: the Listen screen renders the styled **web** volume slider
instead of the native `MPVolumeView`, which is blank in the simulator (see
`docs/native-audio.md`). Everything else is the real app against live data.

## When a scene breaks

A scene that throws leaves the marker moving in red and prints its error into a
red bar along the bottom. The driver can't settle on that, times out after 90s,
saves the last frame as `<name>.png.timeout.png`, and stops. Open that file — the
red bar names the control the harness couldn't find (usually a renamed
`aria-label` or a changed nav order).

## Requirements

- **iOS**: Xcode with the two simulators above installed. The status bar is set
  to 9:41 with full battery and signal via `simctl status_bar`, cleared after.
- **Android**: the SDK (`ANDROID_HOME`) with `platform-tools` and `emulator`, and
  at least one AVD (create one in Android Studio). The status bar is cleaned via
  SystemUI demo mode and a fresh emulator's notifications are snoozed. Play won't
  accept the emulator's native 9:20 aspect, so `wm size`/`wm density` resize it to
  the sizes above and reset afterward.
