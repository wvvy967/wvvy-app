/*
  The pieces every marketed image is built from — the brand gradient, a device
  bezel around a bare capture, a fitted headline — used by `creative.mjs` (the
  App Store header, search and universal creative assets). Everything is drawn
  as SVG and rasterised by `sharp`; there is no browser.

  Ported from na-meetings-near-me's compose.mjs, with the geometry kept intact
  and only the brand swapped to WVVY: the dark ink gradient, signal-green
  accent, and the stencil/typewriter type pairing from app.css. This app ships
  one language, so the per-script (RTL / Devanagari) machinery is dropped.
*/

import sharp from 'sharp';

// WVVY palette (from app.css @theme). A near-black gradient — warm charcoal at
// the top settling to ink at the foot — so the signal-green accent and the
// device screens carry the colour.
export const GRAD_TOP = '#201d1a';
export const GRAD_MID = '#141210';
export const GRAD_BOTTOM = '#0a0908';
export const ACCENT = '#c4ff3d'; // signal green — the one word the eye lands on
export const HEADLINE = '#ece5d8'; // bone
export const SUBTITLE = '#cfc7b8'; // a quieter bone for the line under the name
const BEZEL_FILL = '#050403';

/*
  Fonts named as stacks that mirror app.css: the stencil wordmark falls back to
  Impact, the typewriter label to Courier. If the Google-hosted brand faces
  ('Big Shoulders Stencil', 'Special Elite') aren't installed on the machine
  that renders these, fontconfig takes the next entry — still condensed/bold for
  the wordmark, still monospace for the label — so the asset degrades without
  breaking. Install the two Google fonts for an exact match.
*/
export const WORDMARK = { font: "'Big Shoulders Stencil', Impact, 'Arial Narrow', 'Arial Black', sans-serif", attrs: 'letter-spacing="1"' };
export const LABEL = { font: "'Special Elite', 'Courier New', monospace", attrs: 'letter-spacing="0.5"' };

export function esc(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function render(svg) {
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** A full-canvas ink gradient that every image sits on. */
export function gradientSvg(w, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${GRAD_TOP}"/>
      <stop offset="0.55" stop-color="${GRAD_MID}"/>
      <stop offset="1" stop-color="${GRAD_BOTTOM}"/>
    </linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
  </svg>`;
}

/** A soft drop shadow for a device, as a full-canvas layer. */
export function shadowSvg(w, h, x, y, dw, dh, radius) {
  const blur = Math.round(dw * 0.025);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="${blur}"/>
    </filter></defs>
    <rect x="${x}" y="${y + Math.round(dw * 0.008)}" width="${dw}" height="${dh}" rx="${radius}" ry="${radius}"
          fill="#000000" opacity="0.45" filter="url(#s)"/>
  </svg>`;
}

/**
 * A capture inside a rounded near-black bezel, `outerW` wide. `bezel` and
 * `radius` are fractions of `outerW`. Returns the PNG and its outer size, and
 * the corner radius, for a matching shadow.
 */
export async function deviceImage(rawPath, outerW, { bezel: bezelFrac, radius: radiusFrac }) {
  const bezel = Math.max(2, Math.round(outerW * bezelFrac));
  const outerR = Math.round(outerW * radiusFrac);
  const innerR = Math.max(0, outerR - bezel);
  const innerW = outerW - 2 * bezel;

  const shot = await sharp(rawPath).resize({ width: innerW }).toBuffer();
  const innerH = (await sharp(shot).metadata()).height;
  const mask = await render(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${innerW}" height="${innerH}"><rect width="${innerW}" height="${innerH}" rx="${innerR}" ry="${innerR}" fill="#fff"/></svg>`
  );
  const rounded = await sharp(shot)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const outerH = innerH + 2 * bezel;
  const frame = await render(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outerW}" height="${outerH}">
      <rect width="${outerW}" height="${outerH}" rx="${outerR}" ry="${outerR}" fill="${BEZEL_FILL}"/>
      <rect x="0.5" y="0.5" width="${outerW - 1}" height="${outerH - 1}" rx="${outerR}" ry="${outerR}"
            fill="none" stroke="#ffffff" stroke-opacity="0.10" stroke-width="1.5"/>
    </svg>`
  );
  const image = await sharp(frame)
    .composite([{ input: rounded, left: bezel, top: bezel }])
    .png()
    .toBuffer();
  return { image, width: outerW, height: outerH, radius: outerR };
}

/** One line of text, unpositioned, for measuring. */
function lineSvg(text, size, font, weight) {
  const w = Math.ceil(text.length * size * 1.2) + size * 2;
  const h = Math.ceil(size * 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#000"/>
    <text x="${w / 2}" y="${size * 1.4}" text-anchor="middle" font-family="${font.font}" font-size="${size}" font-weight="${weight}"
          fill="#fff" ${font.attrs}>${esc(text)}</text>
  </svg>`;
}

/** The inked width of `text` at `size`, measured by rendering it. */
export async function measure(text, size, font, weight = 800) {
  const { info } = await sharp(Buffer.from(lineSvg(text, size, font, weight)))
    .trim({ background: '#000', threshold: 10 })
    .toBuffer({ resolveWithObject: true });
  return info.width;
}

/** The largest font size, up to `max`, at which every line fits `maxWidth`. */
export async function fitSize(lines, max, maxWidth, font, weight = 800) {
  const widths = await Promise.all(lines.map((l) => measure(l, max, font, weight)));
  const widest = Math.max(...widths);
  return widest <= maxWidth ? max : Math.floor((max * maxWidth) / widest);
}

/**
 * Text lines as a full-canvas transparent layer. `x` is the anchor (the centre
 * for `anchor: 'middle'`). `top` is where the first line's cap height begins.
 * If `accent` matches a word in a line, that word becomes its own tinted run —
 * the one word the eye lands on.
 */
export function textSvg(w, h, { lines, accent, size, lineHeight, x, top, anchor = 'middle', weight = 800, fill = HEADLINE, font = WORDMARK }) {
  const tspans = lines
    .map((line, i) => {
      const y = Math.round(top + size + i * lineHeight);
      if (accent && line.includes(accent)) {
        const [before, after] = line.split(accent);
        return `<tspan x="${x}" y="${y}">${esc(before)}<tspan fill="${ACCENT}">${esc(accent)}</tspan>${esc(after)}</tspan>`;
      }
      return `<tspan x="${x}" y="${y}">${esc(line)}</tspan>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <text text-anchor="${anchor}" font-family="${font.font}" font-size="${size}" font-weight="${weight}"
          fill="${fill}" ${font.attrs}>${tspans}</text>
  </svg>`;
}

/**
 * Composite layers onto a base and write an opaque PNG. App Store Connect
 * refuses screenshots with an alpha channel, and sharp keeps one from any SVG
 * layer unless told otherwise.
 */
export async function writeOpaque(base, layers, outPath) {
  const flat = await sharp(base).composite(layers).png().toBuffer();
  await sharp(flat).flatten({ background: GRAD_BOTTOM }).removeAlpha().png().toFile(outPath);
}
