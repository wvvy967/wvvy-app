#!/usr/bin/env node
/*
  Marketing frames for the store screenshots — the per-screen set that actually
  goes on the App Store and Play listings.

    node tools/screenshots/frame.mjs                  # every set, from the raw captures
    node tools/screenshots/frame.mjs iphone-6.9       # one set
    node tools/screenshots/frame.mjs --scenes=player,schedule

  `capture.mjs` produces honest, bare device captures — the actual screen, at the
  size each store demands, and nothing else. Those are the source of truth; this
  step never touches them. It *reads* each one and composites it into a marketed
  frame: the WVVY ink gradient, a two-line headline that leads with the outcome,
  and a rounded device bezel that bleeds off the bottom edge so the app UI stays
  as large as possible while still reading as "a screen".

  Kept a separate step from capture (and sharing compose.mjs with creative.mjs so
  the two can't drift into different looks): the captures are slow and rarely
  need redoing, the copy and styling iterate fast, and the bare captures stay on
  disk for when a framed one hides a layout bug behind a gradient.

  Output goes to `store/screenshots/framed/<set>/`, mirroring the raw layout, at
  the same PNG dimensions as the input (the sizes the stores accept; the frame is
  composited within them). Ported from na-meetings-near-me, simplified to this
  app's single language.
*/

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { WORDMARK, deviceImage, fitSize, gradientSvg, render, shadowSvg, textSvg, writeOpaque } from './compose.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const RAW_DIR = join(ROOT, 'store', 'screenshots');
const OUT_DIR = join(RAW_DIR, 'framed');

/*
  The two-line headline per screen, leading with the outcome. The word the eye
  should land on is tinted signal-green (`accent`) and must appear verbatim in
  one of the lines. Keyed by scene — the capture's bare name (01-player.png →
  player). Edit these freely; it's the fast half of the pipeline.
*/
const HEADLINES = {
  player: { lines: ['Tune in, live', 'from the Vineyard'], accent: 'live' },
  schedule: { lines: ['The whole week', 'on one screen'], accent: 'whole week' },
  support: { lines: ['Keep the signal', 'on the air'], accent: 'signal' },
  about: { lines: ['Free-form radio,', 'no playlist'], accent: 'Free-form' }
};

/*
  The sets, mirroring TARGETS in capture.mjs. `in` is where the bare captures
  land; `out` is where the framed ones go, under framed/. `kind` selects the
  proportions below — a tablet capture is nearly square and wants a smaller
  headline than a phone, or the copy swamps the screen.
*/
const SETS = {
  'iphone-6.9': { in: 'app-store/iphone-6.9', out: 'app-store/iphone-6.9', kind: 'phone' },
  'ipad-13': { in: 'app-store/ipad-13', out: 'app-store/ipad-13', kind: 'tablet' },
  // The iPhone Duo's two displays (capture.mjs). Near 1:1.4, so tablet
  // proportions — a phone headline would swamp the squarer canvas. Framed only
  // if captures exist; the sets are skipped otherwise.
  'iphone-duo-outer': { in: 'app-store/iphone-duo-outer', out: 'app-store/iphone-duo-outer', kind: 'tablet' },
  'iphone-duo-inner': { in: 'app-store/iphone-duo-inner', out: 'app-store/iphone-duo-inner', kind: 'tablet' },
  'play-phone': { in: 'play/phone', out: 'play/phone', kind: 'phone' },
  'play-tablet-10': { in: 'play/tablet-10in', out: 'play/tablet-10in', kind: 'tablet' }
};

/*
  Proportions, as fractions of the canvas so one set of numbers works at every
  resolution. `deviceW` is the bezel width; both kinds bleed off the bottom.
  `topPad`/`gap` set the headline band above the device. `fontMax`/`fitW` size
  the headline (fitSize shrinks a long line rather than clipping it). `bezel`/
  `radius` are the surround and corner radius, as fractions of the device width.
*/
const METRICS = {
  phone: { deviceW: 0.8, topPad: 0.05, gap: 0.042, fontMax: 0.074, fitW: 0.9, lineFrac: 1.12, bezel: 0.0138, radius: 0.0775 },
  tablet: { deviceW: 0.84, topPad: 0.045, gap: 0.036, fontMax: 0.054, fitW: 0.84, lineFrac: 1.12, bezel: 0.0095, radius: 0.048 }
};

/** Build the framed PNG for one raw capture. */
async function frameOne(rawPath, outPath, headline, kind) {
  const m = METRICS[kind];
  const { width: W, height: H } = await sharp(rawPath).metadata();

  const size = await fitSize(headline.lines, Math.round(W * m.fontMax), Math.round(W * m.fitW), WORDMARK, 900);
  const lineHeight = Math.round(size * m.lineFrac);
  const top = Math.round(H * m.topPad);
  const headlineBottom = top + size + (headline.lines.length - 1) * lineHeight;

  // Place the device centred, its top below the headline band, bleeding off the
  // bottom. Crop to what fits — sharp refuses an overlay taller than the canvas.
  const device = await deviceImage(rawPath, Math.round(W * m.deviceW), m);
  const deviceTop = headlineBottom + Math.round(H * m.gap);
  const deviceLeft = Math.round((W - device.width) / 2);
  const cropH = Math.min(device.height, H - deviceTop);
  const deviceVisible = await sharp(device.image).extract({ left: 0, top: 0, width: device.width, height: cropH }).toBuffer();

  const base = await render(gradientSvg(W, H));
  const shadow = await render(shadowSvg(W, H, deviceLeft, deviceTop, device.width, cropH, device.radius));
  const text = await render(textSvg(W, H, { ...headline, size, lineHeight, x: W / 2, top, weight: 900, font: WORDMARK }));

  mkdirSync(dirname(outPath), { recursive: true });
  await writeOpaque(
    base,
    [
      { input: shadow, left: 0, top: 0 },
      { input: deviceVisible, left: deviceLeft, top: deviceTop },
      { input: text, left: 0, top: 0 }
    ],
    outPath
  );
}

/* ---------------------------------------------------------------------- run */

const args = process.argv.slice(2);
const scenesArg = args.find((a) => a.startsWith('--scenes='));
const sceneFilter = scenesArg ? new Set(scenesArg.split('=')[1].split(',')) : null;
const setNames = args.filter((a) => !a.startsWith('--'));
const chosen = setNames.length ? setNames : Object.keys(SETS);

// Map a capture's file name (01-player.png) back to its scene key (player).
const sceneOf = (file) =>
  file
    .replace(/^\d+-/, '')
    .replace(/\.png$/, '')
    .replace(/-/g, '');

let framed = 0;
for (const name of chosen) {
  const setDef = SETS[name];
  if (!setDef) {
    console.log(`unknown set "${name}" — known: ${Object.keys(SETS).join(', ')}`);
    process.exit(1);
  }
  const srcDir = join(RAW_DIR, setDef.in);
  if (!existsSync(srcDir)) {
    console.log(`skipping ${name}: no captures at ${setDef.in} (run \`npm run screenshots\` first)`);
    continue;
  }
  const files = readdirSync(srcDir).filter((f) => /^\d+-.*\.png$/.test(f));
  for (const file of files) {
    const scene = sceneOf(file);
    if (sceneFilter && !sceneFilter.has(scene)) continue;
    const headline = HEADLINES[scene];
    if (!headline) {
      console.log(`  no headline for scene "${scene}" (${file}) — skipping`);
      continue;
    }
    const outPath = join(OUT_DIR, setDef.out, file);
    await frameOne(join(srcDir, file), outPath, headline, setDef.kind);
    console.log(`  ${name}/${file} → framed/${setDef.out}/${file}`);
    framed++;
  }
}

console.log(`\nFramed ${framed} screenshot${framed === 1 ? '' : 's'} into ${join('store', 'screenshots', 'framed')}.`);
