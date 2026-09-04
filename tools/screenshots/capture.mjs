#!/usr/bin/env node
/*
  App Store screenshots, captured from the iOS Simulator.

    node tools/screenshots/capture.mjs                     # both device sizes
    node tools/screenshots/capture.mjs iphone-6.9          # one size
    node tools/screenshots/capture.mjs iphone-6.9 --no-build --scenes=player

  The half that runs inside the app is `harness.js` next door. This half boots a
  simulator, gets the app onto it, tells the harness which screen to walk to, and
  decides when the screen is still enough to photograph. Adapted (iOS-only, no
  seeding) from na-meetings-near-me.

  How a screen is chosen: iOS has no debugging protocol to attach to, so the
  scene name is baked into the page — the driver rewrites `index.html` *inside
  the installed app bundle* (the simulator does not verify bundle signatures, so
  no rebuild/reinstall/Xcode) and relaunches. The app boots, walks to the screen,
  and stops.

  How "ready" is decided: two consecutive screenshots that are byte-identical,
  but only after two that *differ* first — proof the harness's blinking marker is
  running, so a launch screen or a frozen webview can't read as "settled".
*/

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BUNDLE_ID = 'org.wvvy.app';

// The two screens asked for, in upload order (the store shows the first in
// search results, so the player leads).
const SCENES = [
  { scene: 'player', file: '01-player.png' },
  { scene: 'schedule', file: '02-schedule.png' },
  { scene: 'support', file: '03-support.png' },
  { scene: 'about', file: '04-about.png' }
];

// The two sizes Apple still requires: one 6.9" iPhone (scaled for smaller
// iPhones) and one 13" iPad, required because the app ships for iPhone + iPad.
const TARGETS = {
  'iphone-6.9': {
    device: 'iPhone 17 Pro Max',
    out: 'app-store/iphone-6.9',
    expect: '1320x2868'
  },
  'ipad-13': {
    device: 'iPad Pro 13-inch (M5)',
    out: 'app-store/ipad-13',
    expect: '2064x2752'
  }
};

/* ------------------------------------------------------------------ plumbing */

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', options.quiet ? 'pipe' : 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
    cwd: ROOT,
    ...options
  });
}

const log = (message) => process.stdout.write(`${message}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The harness, with this run's scene in front of it. */
function harnessSource(scene) {
  const config = JSON.stringify({ scene: scene ?? null });
  return `window.__SHOT_CONFIG=${config};\n${readFileSync(join(HERE, 'harness.js'), 'utf8')}`;
}

function pngSize(buffer) {
  // Width/height are the first two big-endian 32-bit fields of the IHDR chunk.
  return `${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)}`;
}

/**
 * Photograph a device once it has gone still: two byte-identical frames, but
 * only after two that differed (proof the marker is running, so a launch screen
 * or dead webview can't pass as settled). This is also what waits out the live
 * cover art and the schedule's sheet fetch, which have no clean DOM signal.
 */
async function captureSettled(shoot, label, onTimeoutFrame) {
  const digest = (buffer) => createHash('sha1').update(buffer).digest('hex');
  const deadline = Date.now() + 90_000;

  let previousHash = digest(await shoot());
  let sawMovement = false;

  for (;;) {
    await sleep(700);
    const current = await shoot();
    const currentHash = digest(current);

    if (currentHash !== previousHash) sawMovement = true;
    else if (sawMovement) return current;

    if (Date.now() > deadline) {
      if (onTimeoutFrame) onTimeoutFrame(current);
      throw new Error(
        sawMovement
          ? `${label}: never settled after 90s — the scene threw; see the red bar in the saved .timeout.png.`
          : `${label}: the screen never changed, so the harness never ran. Is this the build the driver just patched?`
      );
    }
    previousHash = currentHash;
  }
}

/* ---------------------------------------------------------------------- iOS */

function simctl(args, options = {}) {
  return run('xcrun', ['simctl', ...args], { quiet: true, ...options });
}

/** The newest available simulator with this name, booting it if it is not up. */
function bootSimulator(name) {
  const list = JSON.parse(simctl(['list', 'devices', 'available', '--json']));
  const found = [];
  for (const [runtime, devices] of Object.entries(list.devices)) {
    for (const device of devices) {
      if (device.name === name) found.push({ runtime, ...device });
    }
  }
  if (!found.length) throw new Error(`no simulator named "${name}" is available`);

  found.sort((a, b) => a.runtime.localeCompare(b.runtime, undefined, { numeric: true }));
  const device = found.find((d) => d.state === 'Booted') ?? found[found.length - 1];

  if (device.state !== 'Booted') {
    log(`  booting ${name}`);
    simctl(['boot', device.udid]);
  }
  run('open', ['-a', 'Simulator']);
  simctl(['bootstatus', device.udid]);
  return device.udid;
}

async function captureIos(target, key, scenes, options) {
  const udid = bootSimulator(target.device);

  if (options.build) {
    log(`  building and installing on ${target.device}`);
    run('npx', ['cap', 'run', 'ios', '--target', udid]);
  }

  // 9:41, full battery and signal — the time Apple's own device shots have used
  // since 2007. A store shot may not show a real clock or battery.
  simctl(['status_bar', udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi', '--wifiMode', 'active', '--wifiBars', '3', '--cellularMode', 'active', '--cellularBars', '4', '--batteryState', 'discharging', '--batteryLevel', '100']);

  const container = simctl(['get_app_container', udid, BUNDLE_ID, 'app']).trim();
  const indexPath = join(container, 'public', 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(`the app does not look installed on ${target.device} — run without --no-build`);
  }

  // Kept so the bundle is restored exactly as the build left it, whatever
  // happens below — a patched index.html left behind would seed shot-mode into
  // every later manual run.
  const pristine = readFileSync(indexPath, 'utf8');
  const shotPath = join(tmpdir(), `wvvy-shot-${process.pid}.png`);

  try {
    for (const { scene, file } of scenes) {
      log(`  ${key}: ${scene}`);
      writeFileSync(indexPath, pristine.replace('<head>', `<head>\n<script>\n${harnessSource(scene)}\n</script>`));

      simctl(['terminate', udid, BUNDLE_ID], { stdio: 'ignore' });
      await sleep(600);
      simctl(['launch', udid, BUNDLE_ID]);

      const png = await captureSettled(
        async () => {
          // simctl writes nothing, silently, when handed a relative path.
          simctl(['io', udid, 'screenshot', shotPath]);
          return readFileSync(shotPath);
        },
        `${key}/${scene}`,
        (frame) => writeShot(target, `${file}.timeout.png`, frame)
      );

      writeShot(target, file, png);
    }
  } finally {
    writeFileSync(indexPath, pristine);
    simctl(['status_bar', udid, 'clear'], { stdio: 'ignore' });
  }
}

/* --------------------------------------------------------------------- main */

let outRoot = join(ROOT, 'store', 'screenshots');

function writeShot(target, file, png) {
  const directory = join(outRoot, target.out);
  mkdirSync(directory, { recursive: true });
  const size = pngSize(png);
  if (target.expect && size !== target.expect) {
    log(`  ! ${file} is ${size}, expected ${target.expect}`);
  }
  writeFileSync(join(directory, file), png);
  log(`    → ${join(target.out, file)} (${size})`);
}

async function main() {
  const argv = process.argv.slice(2);
  const options = { build: !argv.includes('--no-build') };

  const sceneArg = argv.find((a) => a.startsWith('--scenes='))?.split('=')[1];
  const scenes = sceneArg ? SCENES.filter((s) => sceneArg.split(',').includes(s.scene)) : SCENES;
  if (!scenes.length) throw new Error(`no scene matches --scenes=${sceneArg}`);

  const outArg = argv.find((a) => a.startsWith('--out='))?.split('=')[1];
  if (outArg) outRoot = outArg;

  const names = argv.filter((a) => !a.startsWith('--'));
  let keys = Object.keys(TARGETS);
  if (names.length) {
    keys = [];
    for (const name of names) {
      if (TARGETS[name]) keys.push(name);
      else throw new Error(`unknown target "${name}" — one of: ${Object.keys(TARGETS).join(', ')}`);
    }
  }

  if (options.build) {
    log('building the web bundle');
    run('npm', ['run', 'build'], { quiet: true });
  }

  for (const key of keys) {
    const target = TARGETS[key];
    log(`\n${key}`);
    await captureIos(target, key, scenes, options);
  }

  log(`\ndone — ${outRoot}`);
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`\n${error.message}\n`);
  process.exit(1);
});
