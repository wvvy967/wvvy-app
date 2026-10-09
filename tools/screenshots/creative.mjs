#!/usr/bin/env node
/*
  App Store creative assets — the product-page header, the search-result asset,
  and the universal asset that can stand in for both.

    node tools/screenshots/creative.mjs            # all three
    node tools/screenshots/creative.mjs --guides   # also write *.guides.png with the safe area drawn

  Sizes and safe areas are Apple's, measured off the static templates
  (creative_assets-*_template-static.psd from developer.apple.com/app-store/
  asset-best-practices). The art is cropped differently on every device, and
  only the green "art safe area" in the template survives every crop, so
  everything that must be read sits inside it and only gradient and device
  edges are allowed outside:

    asset          canvas        safe area (x, y, w × h)
    header         3840 × 1646   1097, 493, 1646 × 661
    search         3840 × 2560   836, 765, 2168 × 1030
    universal      5244 × 2950   1921, 660, 1402 × 962

  The two layouts follow Apple's guidance for each:

    - Header / universal: "a single, clear idea" — the brand lockup (icon, name,
      subtitle) and nothing else inside the safe area. Wider displays reveal a
      phone either side of it; narrow ones crop them away.
    - Search: "state the obvious / showcase the firsthand experience" — a
      headline above the real Listen and Schedule screens, which bleed off the
      bottom.

  Reads the iPhone 6.9" captures (`capture.mjs`) from
  store/screenshots/app-store/iphone-6.9 and writes
  store/screenshots/framed/app-store/creative. Ported from na-meetings-near-me,
  simplified to this app's single language. The compositing geometry is shared
  with that project via compose.mjs so the two read as the same house style.
*/

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ACCENT, LABEL, SUBTITLE, WORDMARK, deviceImage, esc, fitSize, gradientSvg, render, shadowSvg, textSvg, writeOpaque } from './compose.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const RAW_DIR = join(ROOT, 'store', 'screenshots', 'app-store', 'iphone-6.9');
const OUT_DIR = join(ROOT, 'store', 'screenshots', 'framed', 'app-store', 'creative');

// The app's real name and the line beneath it. Artwork has no store-subtitle
// character cap, so it can say plainly what the app is to someone who has never
// heard of it.
const APP_NAME = 'WVVY 96.7 LPFM';
const SUBTITLE_TEXT = "Martha's Vineyard Community Radio";

// The one idea on the search asset — the firsthand experience, with the word
// the eye should land on tinted signal-green.
const HEADLINE_COPY = { lines: ['Live community radio', 'from the Vineyard'], accent: 'Live' };

// The two screens that flank the lockup and sit under the search headline.
const SCENES = ['player', 'schedule'];

const ASSETS = {
  header: { w: 3840, h: 1646, safe: { x: 1097, y: 493, w: 1646, h: 661 }, layout: 'lockup' },
  search: { w: 3840, h: 2560, safe: { x: 836, y: 765, w: 2168, h: 1030 }, layout: 'split' },
  universal: { w: 5244, h: 2950, safe: { x: 1921, y: 660, w: 1402, h: 962 }, layout: 'lockup' }
};

// Same bezel proportions as a framed phone (na-meetings frame.mjs METRICS.phone).
const PHONE = { bezel: 0.0138, radius: 0.0775 };

/** The app icon at `size`, masked to the iOS corner radius. */
async function iconImage(size) {
  const r = Math.round(size * 0.2237);
  const icon = await sharp(join(ROOT, 'assets', 'icon.png'))
    .resize(size, size)
    .png()
    .toBuffer();
  const mask = await render(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);
  return sharp(icon)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

/** A phone placed at x, y, cropped to the canvas, with its shadow. */
async function phoneLayers(W, H, file, x, y, width) {
  const d = await deviceImage(file, width, PHONE);
  const top = Math.max(0, y);
  const left = Math.max(0, x);
  const cropTop = top - y;
  const cropLeft = left - x;
  const w = Math.min(d.width - cropLeft, W - left);
  const h = Math.min(d.height - cropTop, H - top);
  if (w <= 0 || h <= 0) return [];
  const visible = await sharp(d.image).extract({ left: cropLeft, top: cropTop, width: w, height: h }).toBuffer();
  const shadow = await render(shadowSvg(W, H, x, y, d.width, d.height, d.radius));
  return [
    { input: shadow, left: 0, top: 0 },
    { input: visible, left, top }
  ];
}

/*
  Header / universal: the lockup centred in the safe area — icon above name
  above subtitle — with a phone either side outside it: decoration a wide
  display shows and a narrow one crops, never something the idea depends on.
*/
async function lockup(asset, shots) {
  const { w: W, h: H, safe } = asset;

  const iconSize = Math.round(safe.h * 0.36);
  const nameSize = await fitSize([APP_NAME], Math.round(safe.h * 0.17), safe.w * 0.88, WORDMARK, 900);
  const subSize = await fitSize([SUBTITLE_TEXT], Math.round(safe.h * 0.085), safe.w * 0.85, LABEL, 400);
  const gap = Math.round(safe.h * 0.06);

  const blockH = iconSize + gap + nameSize + gap * 0.9 + subSize;
  const iconTop = Math.round(safe.y + (safe.h - blockH) / 2);
  const nameTop = iconTop + iconSize + gap;
  const subTop = nameTop + nameSize + Math.round(gap * 0.9);
  const cx = safe.x + safe.w / 2;

  // Phones flank the safe area, tops level with the icon, bleeding off the
  // bottom. Sized to the space beside the safe area, not into it.
  const side = safe.x;
  const phoneW = Math.round(Math.min(side * 0.62, H * 0.42));
  const phoneTop = Math.round(safe.y - safe.h * 0.08);
  const leftX = Math.round(side / 2 - phoneW / 2 + side * 0.08);
  const rightX = W - leftX - phoneW;

  return [
    ...(await phoneLayers(W, H, shots[0], leftX, phoneTop, phoneW)),
    ...(await phoneLayers(W, H, shots[1], rightX, phoneTop, phoneW)),
    { input: await iconImage(iconSize), left: Math.round(cx - iconSize / 2), top: iconTop },
    { input: await render(textSvg(W, H, { lines: [APP_NAME], size: nameSize, lineHeight: nameSize, x: cx, top: nameTop, weight: 900, font: WORDMARK })), left: 0, top: 0 },
    {
      input: await render(textSvg(W, H, { lines: [SUBTITLE_TEXT], size: subSize, lineHeight: subSize, x: cx, top: subTop, weight: 400, fill: SUBTITLE, font: LABEL })),
      left: 0,
      top: 0
    }
  ];
}

/*
  Search: the headline across the top of the safe area, as large as its width
  allows, with two large phones beneath it bleeding off the bottom edge. Only
  the headline has to be read, so only the headline is held to the safe area;
  the phones are allowed outside it and a harsher crop simply shows less of them.
  No icon — the search row already shows it directly above.
*/
async function split(asset, shots, headline) {
  const { w: W, h: H, safe } = asset;

  const inset = Math.round(safe.w * 0.05);
  const pad = Math.round(safe.h * 0.03);
  const textW = safe.w - 2 * inset;
  const cx = safe.x + safe.w / 2;

  const size = await fitSize(headline.lines, Math.round(safe.h * 0.22), textW, WORDMARK, 900);
  const lineHeight = Math.round(size * 1.12);
  const textTop = safe.y + pad;
  const textBottom = textTop + size + (headline.lines.length - 1) * lineHeight;

  const phoneW = Math.round(W * 0.225);
  const phoneGap = Math.round(phoneW * 0.14);
  const phonesX = Math.round(cx - (2 * phoneW + phoneGap) / 2);
  const y0 = textBottom + Math.round(size * 0.55);
  const stagger = Math.round(phoneW * 0.12);

  return [
    ...(await phoneLayers(W, H, shots[0], phonesX, y0, phoneW)),
    ...(await phoneLayers(W, H, shots[1], phonesX + phoneW + phoneGap, y0 + stagger, phoneW)),
    { input: await render(textSvg(W, H, { ...headline, size, lineHeight, x: cx, top: textTop, weight: 900, font: WORDMARK })), left: 0, top: 0 }
  ];
}

/** The template's safe area, outlined, for checking a composition by eye. */
function guidesSvg({ w, h, safe }) {
  const s = Math.max(4, Math.round(w / 640));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect x="${safe.x}" y="${safe.y}" width="${safe.w}" height="${safe.h}" fill="none" stroke="${ACCENT}" stroke-width="${s}"/>
    <text x="${safe.x + s * 3}" y="${safe.y + safe.h - s * 3}" font-family="Helvetica" font-weight="700" font-size="${s * 10}" fill="${ACCENT}">${esc('ART SAFE AREA')}</text>
  </svg>`;
}

/* ---------------------------------------------------------------------- run */

const guides = process.argv.slice(2).includes('--guides');

const files = existsSync(RAW_DIR) ? readdirSync(RAW_DIR) : [];
const find = (scene) => files.find((f) => f.replace(/^\d+-/, '').replace(/\.png$/, '') === scene);
const shots = SCENES.map(find);
if (shots.some((s) => !s)) {
  console.error(`No iPhone captures for [${SCENES.join(', ')}] in ${RAW_DIR.slice(ROOT.length + 1)} — run \`npm run screenshots:ios\` first.`);
  process.exit(1);
}
const shotPaths = shots.map((f) => join(RAW_DIR, f));

mkdirSync(OUT_DIR, { recursive: true });

let made = 0;
for (const [name, asset] of Object.entries(ASSETS)) {
  const layers = asset.layout === 'split' ? await split(asset, shotPaths, HEADLINE_COPY) : await lockup(asset, shotPaths);
  const base = await render(gradientSvg(asset.w, asset.h));
  const out = join(OUT_DIR, `${name}-${asset.w}x${asset.h}.png`);
  await writeOpaque(base, layers, out);
  if (guides) {
    await writeOpaque(out, [{ input: await render(guidesSvg(asset)), left: 0, top: 0 }], out.replace(/\.png$/, '.guides.png'));
  }
  console.log(`  ${name} → ${out.slice(ROOT.length + 1)}`);
  made++;
}

console.log(`\nMade ${made} creative asset${made === 1 ? '' : 's'}.`);
