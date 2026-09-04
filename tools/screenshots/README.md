# Store screenshots

Regenerates the App Store screenshot set from the iOS Simulator.

```bash
npm run screenshots                                  # both sizes, both screens
node tools/screenshots/capture.mjs iphone-6.9        # one size
node tools/screenshots/capture.mjs iphone-6.9 --no-build --scenes=player
```

Output lands in `store/screenshots/` (gitignored — regenerating is cheap and the
App Store keeps whatever was uploaded).

## What it captures

Two screens, in upload order, on the two device sizes Apple still requires:

| Set          | Device                | Size        | Where it goes                 |
| ------------ | --------------------- | ----------- | ----------------------------- |
| `iphone-6.9` | iPhone 17 Pro Max     | 1320 × 2868 | App Store, iPhone (required)  |
| `ipad-13`    | iPad Pro 13-inch (M5) | 2064 × 2752 | App Store, iPad (required¹)   |

- `01-player.png` — the Listen screen: cover art, now playing, transport, volume.
- `02-schedule.png` — the weekly schedule, today first.

¹ Required because the app ships for iPhone + iPad. Drop the iPad set only if that
changes.

## How it works

Two files. `harness.js` runs **inside** the app; `capture.mjs` drives the
simulator from outside. Read `harness.js` first. Both are adapted from
na-meetings-near-me, iOS-only and without its state seeding (WVVY shows live
data — real now-playing, the real schedule sheet).

The short version: the app is a webview, so the harness walks it to each screen
by clicking its own controls (`nav a`, by index), not a coordinate. iOS has no
debugging protocol to attach to, so the driver bakes the scene name into the page
by rewriting `index.html` **inside the installed app bundle** (the simulator does
not verify bundle signatures — no rebuild, no Xcode) and relaunches.

**A shot is taken once two consecutive screenshots are byte-identical, and only
after two that differed.** While a scene runs, the harness animates a small
square in the corner, so a page mid-scene can never look settled; the square is
removed before the screen goes still. That is also what waits out the live cover
art and the schedule's Google-sheet fetch, which have no clean DOM signal.

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

Xcode with the two simulators above installed. The status bar is set to 9:41 with
full battery and signal via `simctl status_bar`, and cleared again afterwards.
