# App icon + splash sources

Every launcher icon and splash screen in `ios/` and `android/` is generated from
the files in this folder:

```bash
npm run assets     # capacitor-assets generate --ios --android
```

Commit the regenerated output — `ios/` and `android/` are tracked (see the note
in `.gitignore`).

| File                  | Size      | Used for                                                |
| --------------------- | --------- | ------------------------------------------------------- |
| `icon.png`            | 1024×1024 | iOS app icon; Android legacy launcher icon              |
| `icon-foreground.png` | 1024×1024 | Android adaptive icon foreground (transparent)          |
| `icon-background.png` | 1024×1024 | Android adaptive icon background (solid ink)            |
| `splash.png`          | 2732×2732 | Launch screen, both platforms                           |
| `splash-dark.png`     | 2732×2732 | Dark-mode launch screen (identical — we're always dark) |
| `logo-full.png`       | 1024×1024 | Source for the splash only; not an output itself        |

`--ios --android` is not optional: without the platform flags the tool also tries
to generate PWA assets and fails looking for `www/manifest.json`, because
Capacitor's default `webDir` is `www` and ours is `build`. The web manifest icons
are handled separately by `vite-plugin-pwa` from `static/`.

## Two different lockups, on purpose

The website's icon stacks **WVVY / 96.7 / LPFM**. That reads fine at 512px, but a
launcher draws an icon at roughly 48–96px, where the two sub-lines collapse into
unreadable texture.

So the app icon uses the **wordmark alone** (`icon.png`, `icon-foreground.png`),
which lets WVVY itself grow several times larger in the same square. The
**splash** keeps the full stacked lockup (`logo-full.png` → `splash.png`), since
it's drawn near full-screen where all three lines are legible.

The web/PWA icon in `static/` is untouched and still uses the full mark, matching
the site.

## Sizing the adaptive foreground

Android composites the adaptive icon on a 108dp canvas and masks it — circle,
squircle, or rounded square depending on the launcher. Only the inner 72dp is
_guaranteed_ unclipped, but essentially every current launcher masks at or near
the full canvas, and sizing to that 72dp guarantee leaves the mark looking
marooned in a sea of ink (measured: the wordmark came out ~55% of the visible
circle's width).

The foreground is therefore sized so its **half-diagonal fits a full-canvas
circle** — 694×242px within the 1024 canvas. That deliberately exceeds the
conservative 72dp zone. The tradeoff is accepted knowingly: on a hypothetical
launcher using a strict 72dp mask the outermost W/Y edges could shave. If you
ever need to be maximally safe, re-render at a target width of 295 viewBox units
instead of 350 and regenerate.

`capacitor-assets` preserves the source ratio rather than applying its own inset
— verified by measuring the generated `ic_launcher_foreground.png` (115×43 of a
192px canvas ≈ the same 58% as the source), so what you set here is what ships.

## Regenerating the sources themselves

The artwork derives from `icon.svg` in the website repo, which sets its type in
**Big Shoulders Stencil** — a Google font. That matters: rasterising the SVG with
a tool that lacks the font (`rsvg-convert`, ImageMagick, most CI images) silently
falls back to Impact and produces a solid, non-stencil wordmark that looks close
enough to miss in review but is visibly off-brand next to the site.

The reliable route is to render it in a browser with the webfont actually loaded
(await `document.fonts.ready`), at 512 CSS px on a 2× display so the capture is
exactly 1024². Scale the mark by measuring its `getBBox()` and centring on that
box — the stencil face has asymmetric side bearings, so tuning `font-size` alone
leaves it visibly off-centre.

Then derive the rest:

```bash
# adaptive foreground: key out the ink background to alpha
magick fg-render.png -fuzz 8% -transparent '#0a0908' icon-foreground.png

# background: solid brand ink
magick -size 1024x1024 xc:'#0a0908' icon-background.png

# splash: the full stacked lockup, small, on ink
magick logo-full.png -fuzz 8% -transparent '#0a0908' -resize 26% \
  -background '#0a0908' -gravity center -extent 2732x2732 splash.png
```

Keying out `#0a0908` is safe because the mark only uses signal green and bone —
there is no ink-coloured detail inside the logo to punch through.
