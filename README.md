<p align="center">
  <img src="static/icon.svg" alt="WVVY logo" width="128" height="128">
</p>

# WVVY App

Cross-platform player app for **WVVY 96.7 LPFM** — low-power community radio out
of Tisbury, Martha's Vineyard. One codebase ships iOS, Android, and web.

Deliberately narrower than [wvvy.org](https://wvvy.org): this is a music player
first. Tune in, see what's on, support the station.

## Stack

SvelteKit 2 (Svelte 5 runes) · `adapter-static` · Tailwind 4 · Capacitor 8 ·
Vite 8 · Vitest

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm run all          # format → lint → check → test → build
```

## Screens

| Route       | Purpose                                                                  |
| ----------- | ------------------------------------------------------------------------ |
| `/`         | Listen — album art, now playing, play control, listeners, recent tracks  |
| `/schedule` | Weekly DJ schedule, day-tabbed, with an "on now" badge                   |
| `/support`  | Donate — Venmo, PayPal, check by mail, 501(c)(3) receipt info            |
| `/about`    | Station info, get involved, stream URLs for other players, signal detail |

## PWA

The web target is an installable PWA — same codebase, no separate build. The app
shell (all four routes, icons, JS, CSS) is precached, so it opens offline; the
stream and now-playing feed are `NetworkOnly`, because a cached "now playing" is
worse than none.

Two integration details worth knowing before touching the config, both of which
fail _silently_:

- **`@vite-pwa/sveltekit`, not plain `vite-plugin-pwa`.** The static adapter
  writes prerendered HTML after Vite's build finishes, so a plain Workbox glob
  runs too early and precaches zero HTML — the service worker installs, looks
  healthy, and the app still dies offline.
- **Registration and the manifest link are wired by hand** (`src/lib/pwa.ts` and
  `src/app.html`). `injectRegister` targets the plugin's own `index.html`, which
  SvelteKit overwrites, so auto-injection never lands.

Registration is skipped inside Capacitor: the bundle is already on the device,
and a service worker there only adds a cache layer that can serve a stale build
after an app update.

To verify offline after a change — emulated offline in DevTools is not reliable
here, so stop the server instead:

```bash
npm run build && npx vite preview --port 5200
# load the page, wait for the SW to activate, then kill the server and reload
```

## Native builds

```bash
npm run ios          # build → sync → open Xcode
npm run android      # build → sync → open Android Studio
```

`ios/` and `android/` are **committed**, not generated on demand — they contain
hand-written background-audio configuration that `npx cap add` does not
reproduce. See [docs/native-audio.md](docs/native-audio.md).

### Android prerequisites

Android builds need a **JDK 21** and Android Studio; neither is required for iOS
or web work.

```bash
brew install --cask temurin@21 android-studio
```

Then open the project once via `npm run android` and let Gradle sync.

### On-device development with hot reload

```bash
npm run dev:host                      # serves on your LAN at :5001
```

Uncomment the `server` block in `capacitor.config.ts` with your workstation IP
(`ipconfig getifaddr en0`), then `npx cap sync`. **Re-comment it before any
production build** — a shipped app pointing at a dev server is a dead app.

## Audio architecture

Playback lives behind the `PlaybackEngine` interface rather than in the UI,
because CarPlay and Android Auto cannot see an HTML `<audio>` element and would
otherwise require rewriting the player.

Background playback and lock-screen controls work today on iOS. CarPlay needs an
Apple entitlement (request early — it gates everything) plus a native engine.
Android background playback has a real caveat worth reading before shipping.

All of it, with the reasoning: **[docs/native-audio.md](docs/native-audio.md)**.

## Data

Audio and now-playing come from the station's AzuraCast install at
`radio.wvvy.org`:

- Stream — `https://radio.wvvy.org/listen/wvvy/radio.mp3`
- Metadata — `https://radio.wvvy.org/api/station/wvvy/nowplaying`, polled every
  30s while the app is visible and paused entirely when backgrounded.

The schedule comes from the same published Google Sheet the website uses, so the
station manager edits one place and both update. It's fetched once per session,
with a static fallback in `src/lib/schedule.ts` if the sheet is unreachable — the
UI says which one it's showing rather than passing stale times off as live.

Station constants live in `src/lib/station.ts`.

## Testing

```bash
npm test             # unit tests
npm run coverage
```

Unit tests cover the AzuraCast parser and the playback engine's state machine
(reconnect backoff, giving up, metadata dedupe). Background audio, lock-screen
controls, and Bluetooth routing cannot be exercised in jsdom — there's a manual
device checklist at the end of `docs/native-audio.md`.

## License

MIT
