#!/usr/bin/env node
/*
  Store screenshots, captured from the iOS Simulator and the Android emulator.

    node tools/screenshots/capture.mjs                     # every target
    node tools/screenshots/capture.mjs iphone-6.9          # one target
    node tools/screenshots/capture.mjs ios                 # both iOS sizes
    node tools/screenshots/capture.mjs android             # the Play sizes
    node tools/screenshots/capture.mjs play-phone --no-build --scenes=player

  The half that runs inside the app is `harness.js` next door; read its header
  first. This half boots devices, gets the app onto them, tells the harness which
  screen to walk to, and decides when the screen is still enough to photograph.
  Adapted from na-meetings-near-me (WVVY has no map and needs no state seeding).

  ## How a screen is chosen

  iOS and Android arrive at the same place by different roads, because only one
  of them lets us talk to a running webview.

  **iOS** has no debugging protocol we can attach to from a script, so the scene
  name is baked into the page: the driver rewrites `index.html` *inside the
  installed app bundle* — the simulator does not verify bundle signatures, so
  this needs no rebuild, no reinstall and no Xcode — then relaunches. The app
  boots, walks to the screen and stops.

  **Android** has one, so nothing is rewritten: the harness is registered with
  `Page.addScriptToEvaluateOnNewDocument` so it still runs before the app does,
  and each screen is a `Runtime.evaluate` of `window.__shot.run(...)` we await.

  ## How "ready" is decided

  Two consecutive screenshots that are byte-identical. On iOS that only counts
  after two that *differ* first — proof the harness's blinking marker is running,
  so a launch screen or a frozen webview can't read as "settled". Android awaits
  the scene over the protocol before sampling, so the marker is already gone and
  the still screen is the proof; there, movement is not required.
*/

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BUNDLE_ID = 'org.wvvy.app';

// The four screens, in upload order (the store shows the first in search
// results, so the player leads).
const SCENES = [
  { scene: 'player', file: '01-player.png' },
  { scene: 'schedule', file: '02-schedule.png' },
  { scene: 'support', file: '03-support.png' },
  { scene: 'about', file: '04-about.png' }
];

/*
  Devices.

  The two iOS sizes are the two Apple still requires: one 6.9" iPhone, which it
  scales down for every smaller iPhone, and one 13" iPad, required because the
  app ships for iPhone + iPad.

  Play is stranger. The emulator's own 1080x2400 is 9:20, outside the aspect
  ratio Play accepts, so the phone target resizes it to a true 9:16. The tablet
  target resizes the *same* emulator to 1600x2560dp rather than booting a second
  AVD: WVVY's layout is driven entirely by CSS width, so a 10" tablet and an
  emulator told it is one render identically — and one AVD is one thing to keep
  working. play-tablet-10 is optional; Play only requires phone screenshots.
*/
const TARGETS = {
  'iphone-6.9': {
    platform: 'ios',
    device: 'iPhone 17 Pro Max',
    out: 'app-store/iphone-6.9',
    expect: '1320x2868'
  },
  'ipad-13': {
    platform: 'ios',
    device: 'iPad Pro 13-inch (M5)',
    out: 'app-store/ipad-13',
    expect: '2064x2752'
  },
  'play-phone': {
    platform: 'android',
    out: 'play/phone',
    wm: { size: '1080x1920', density: 420 },
    expect: '1080x1920'
  },
  'play-tablet-10': {
    platform: 'android',
    out: 'play/tablet-10in',
    wm: { size: '1600x2560', density: 320 },
    expect: '1600x2560'
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
 * Photograph a device once it has gone still.
 *
 * See the header. `shoot` returns the current screen as PNG bytes.
 *
 * `requireMovement` is the difference between the two platforms. iOS starts
 * sampling the moment the app is launched, while the scene is still walking, so
 * it insists on seeing the marker move before it trusts a still screen —
 * without that, a launch screen or a dead webview reads as "settled". Android
 * awaits the scene over the debugging protocol first, so by the time sampling
 * starts the marker is already gone and the screen is *supposed* to be still;
 * the resolved promise is the proof, and demanding movement would time out on
 * every screen.
 */
async function captureSettled(shoot, label, { onTimeoutFrame, requireMovement = true } = {}) {
  const digest = (buffer) => createHash('sha1').update(buffer).digest('hex');
  const deadline = Date.now() + 90_000;

  let previousHash = digest(await shoot());
  let sawMovement = !requireMovement;

  for (;;) {
    await sleep(700);
    const current = await shoot();
    const currentHash = digest(current);

    if (currentHash !== previousHash) sawMovement = true;
    else if (sawMovement) return current;

    if (Date.now() > deadline) {
      // A bad shot that is merely warned about is a bad shot that gets uploaded.
      // Save the last frame beside the set with a `.timeout.png` suffix instead
      // — the harness prints its own error into a red bar along the bottom.
      if (onTimeoutFrame) onTimeoutFrame(current);
      throw new Error(
        sawMovement
          ? `${label}: never settled after 90s — the scene is still running, or it threw; see the red bar in the saved .timeout.png.`
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
  simctl([
    'status_bar',
    udid,
    'override',
    '--time',
    '9:41',
    '--dataNetwork',
    'wifi',
    '--wifiMode',
    'active',
    '--wifiBars',
    '3',
    '--cellularMode',
    'active',
    '--cellularBars',
    '4',
    '--batteryState',
    'discharging',
    '--batteryLevel',
    '100'
  ]);

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
        { onTimeoutFrame: (frame) => writeShot(target, `${file}.timeout.png`, frame) }
      );

      writeShot(target, file, png);
    }
  } finally {
    writeFileSync(indexPath, pristine);
    simctl(['status_bar', udid, 'clear'], { stdio: 'ignore' });
  }
}

/* ------------------------------------------------------------------ Android */

function adbPath() {
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(process.env.HOME ?? '', 'Library/Android/sdk')].filter(Boolean);
  for (const root of roots) {
    const candidate = join(root, 'platform-tools', 'adb');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('adb not found — set ANDROID_HOME');
}

const ADB = { path: null };
function adb(args, options = {}) {
  ADB.path ??= adbPath();
  return run(ADB.path, args, { quiet: true, ...options });
}

function adbBinary(args) {
  ADB.path ??= adbPath();
  return execFileSync(ADB.path, args, { maxBuffer: 256 * 1024 * 1024 });
}

async function bootEmulator() {
  const attached = adb(['devices'])
    .split('\n')
    .slice(1)
    .map((line) => line.split('\t')[0].trim())
    .filter(Boolean);
  if (attached.length) return attached[0];

  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(process.env.HOME ?? '', 'Library/Android/sdk');
  const emulator = join(sdk, 'emulator', 'emulator');
  const avds = run(emulator, ['-list-avds'], { quiet: true }).trim().split('\n').filter(Boolean);
  if (!avds.length) throw new Error('no Android virtual device exists — create one in Android Studio');

  log(`  booting emulator ${avds[0]}`);
  // Detached: the emulator outlives this process and is left running, which is
  // what anyone iterating on a scene wants.
  spawn(emulator, ['-avd', avds[0], '-netdelay', 'none', '-netspeed', 'full'], {
    detached: true,
    stdio: 'ignore'
  }).unref();

  adb(['wait-for-device']);
  for (let i = 0; i < 120; i++) {
    if (adb(['shell', 'getprop', 'sys.boot_completed']).trim() === '1') break;
    await sleep(2000);
  }
  return adb(['devices']).split('\n')[1].split('\t')[0].trim();
}

/** SystemUI demo mode: a clean status bar, the same idea as simctl status_bar. */
function androidStatusBar(serial) {
  const demo = (args) =>
    adb(['-s', serial, 'shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', ...args], {
      stdio: 'ignore'
    });
  demo(['-e', 'command', 'enter']);
  demo(['-e', 'command', 'clock', '-e', 'hhmm', '0941']);
  demo(['-e', 'command', 'battery', '-e', 'level', '100', '-e', 'plugged', 'false']);
  // `fully true` stops the wifi glyph carrying the "connected but no internet"
  // exclamation mark, which on a store page reads as an app that reaches nothing.
  demo(['-e', 'command', 'network', '-e', 'wifi', 'show', '-e', 'level', '4', '-e', 'fully', 'true']);
  demo(['-e', 'command', 'network', '-e', 'mobile', 'hide']);
  demo(['-e', 'command', 'notifications', '-e', 'visible', 'false']);
}

/*
  Take the system's own notification icons out of the status bar.

  A fresh emulator posts a Safety Center recommendation — "set a screen lock" —
  which sits in the status bar as a shield and would appear in every screenshot.
  Demo mode's `notifications visible false` does not hide it, and disabling
  Safety Center does not retract a notification already posted. Snoozing is the
  gentle way: they come back on their own two hours later. Note the quoting — a
  notification key contains `|`, which the device's shell would read as a pipe.
*/
function quietNotifications(serial) {
  const keys = adb(['-s', serial, 'shell', 'cmd', 'notification', 'list'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (const key of keys) {
    adb(['-s', serial, 'shell', `cmd notification snooze --for 7200000 '${key}'`], { stdio: 'ignore' });
  }
}

/**
 * A very small Chrome DevTools Protocol client.
 *
 * Node has had a global WebSocket since 22, so this needs no dependency. Only
 * a few methods are used: register the harness, reload, evaluate.
 */
class Cdp {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();

  static async attach(serial) {
    ADB.path ??= adbPath();
    // The devtools socket is named after the pid of whatever owns the webview,
    // so it changes every time the app is restarted.
    const sockets = run(ADB.path, ['-s', serial, 'shell', 'cat', '/proc/net/unix'], { quiet: true });
    const match = /webview_devtools_remote_(\d+)/.exec(sockets);
    if (!match) throw new Error('no debuggable webview — is this a debug build, and is the app running?');

    run(ADB.path, ['-s', serial, 'forward', 'tcp:9222', `localabstract:webview_devtools_remote_${match[1]}`], {
      quiet: true
    });

    const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
    const page = pages.find((p) => p.type === 'page');
    if (!page) throw new Error('the webview exposes no page to attach to');

    const client = new Cdp();
    await client.#connect(page.webSocketDebuggerUrl);
    return client;
  }

  #connect(url) {
    return new Promise((resolve, reject) => {
      this.#socket = new WebSocket(url);
      this.#socket.addEventListener('open', () => resolve());
      this.#socket.addEventListener('error', () => reject(new Error('could not attach to the webview')));
      this.#socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.id && this.#pending.has(message.id)) {
          const { resolve: done, reject: fail } = this.#pending.get(message.id);
          this.#pending.delete(message.id);
          if (message.error) fail(new Error(message.error.message));
          else done(message.result);
        } else if (message.method && this.#listeners.has(message.method)) {
          this.#listeners.get(message.method)();
          this.#listeners.delete(message.method);
        }
      });
    });
  }

  send(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  once(event) {
    return new Promise((resolve) => this.#listeners.set(event, resolve));
  }

  close() {
    this.#socket.close();
  }
}

/*
  Both Play targets are the same emulator at two sizes, so the APK is built and
  installed for the first of them and reused for the second.
*/
let androidInstalled = false;

async function captureAndroid(target, key, scenes, options) {
  const serial = await bootEmulator();

  if (options.build && !androidInstalled) {
    log('  building and installing on the emulator');
    run('npx', ['cap', 'run', 'android', '--target', serial]);
    androidInstalled = true;
  }

  // Play will not take the emulator's native 9:20. See the note on TARGETS.
  adb(['-s', serial, 'shell', 'wm', 'size', target.wm.size]);
  adb(['-s', serial, 'shell', 'wm', 'density', String(target.wm.density)]);
  quietNotifications(serial);
  androidStatusBar(serial);

  try {
    for (const { scene, file } of scenes) {
      log(`  ${key}: ${scene}`);

      // A fresh process per scene, so the webview is rebuilt at the new size and
      // the harness runs against a cold start — the conditions the iOS side gets
      // from relaunching.
      adb(['-s', serial, 'shell', 'am', 'force-stop', BUNDLE_ID], { stdio: 'ignore' });
      await sleep(1500);
      adb(['-s', serial, 'shell', 'monkey', '-p', BUNDLE_ID, '-c', 'android.intent.category.LAUNCHER', '1'], {
        stdio: 'ignore'
      });
      await sleep(4000);

      const cdp = await Cdp.attach(serial);
      try {
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        // Registered rather than injected, so it runs before the app's own
        // bundle on the reload below.
        await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: harnessSource(null) });
        const loaded = cdp.once('Page.loadEventFired');
        await cdp.send('Page.reload', { ignoreCache: true });
        await loaded;

        /*
          Bounded, because `awaitPromise` has no timeout of its own: a scene
          waiting on an element that will never appear would hold the promise
          open for as long as the process lives. The harness gives up on its own
          waits well inside this, so hitting it means something worse.
        */
        const result = await Promise.race([
          cdp.send('Runtime.evaluate', {
            expression: `window.__shot.run(${JSON.stringify(scene)})`,
            awaitPromise: true,
            returnByValue: true
          }),
          sleep(120_000).then(() => {
            throw new Error(`${key}/${scene}: the scene never returned`);
          })
        ]);
        if (result.exceptionDetails) {
          throw new Error(`${scene}: ${result.exceptionDetails.exception?.description ?? 'scene failed'}`);
        }

        quietNotifications(serial);
        androidStatusBar(serial);
        const png = await captureSettled(async () => adbBinary(['-s', serial, 'exec-out', 'screencap', '-p']), `${key}/${scene}`, {
          onTimeoutFrame: (frame) => writeShot(target, `${file}.timeout.png`, frame),
          requireMovement: false
        });
        writeShot(target, file, png);
      } finally {
        cdp.close();
      }
    }
  } finally {
    /*
      Teardown must not throw. Each of these can fail on its own — most often
      because the emulator went unreachable mid-run — and a throw here replaces
      whatever real error sent us into the finally, so the log ends up blaming
      `wm size reset` for a scene that actually failed. Warn and press on.
    */
    const teardown = (args) => {
      try {
        adb(['-s', serial, ...args], { stdio: 'ignore' });
      } catch (error) {
        log(`  ! teardown "${args.join(' ')}" failed: ${error.message}`);
      }
    };
    teardown(['shell', 'wm', 'size', 'reset']);
    teardown(['shell', 'wm', 'density', 'reset']);
    teardown(['shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', 'exit']);
  }
}

/* --------------------------------------------------------------------- main */

let outRoot = join(ROOT, 'store', 'screenshots');

function writeShot(target, file, png) {
  const directory = join(outRoot, target.out);
  mkdirSync(directory, { recursive: true });
  const size = pngSize(png);
  if (target.expect && size !== target.expect) {
    // Not fatal — a store rejects the wrong size, but so does stopping a run
    // several screens in. Say it loudly instead.
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
      if (name === 'ios' || name === 'android') {
        keys.push(...Object.keys(TARGETS).filter((k) => TARGETS[k].platform === name));
      } else if (TARGETS[name]) {
        keys.push(name);
      } else {
        throw new Error(`unknown target "${name}" — one of: ${Object.keys(TARGETS).join(', ')}, ios, android`);
      }
    }
  }

  // The web bundle is what both platforms package, so it is built once here
  // rather than by each platform's run.
  if (options.build) {
    log('building the web bundle');
    run('npm', ['run', 'build'], { quiet: true });
  }

  for (const key of keys) {
    const target = TARGETS[key];
    log(`\n${key} (${target.platform})`);
    if (target.platform === 'ios') await captureIos(target, key, scenes, options);
    else await captureAndroid(target, key, scenes, options);
  }

  log(`\ndone — ${outRoot}`);

  /*
    Exit rather than fall off the end. Attaching to the webview goes through
    `fetch`, whose keep-alive pool holds the event loop open for another minute
    or so after the last request, which looks exactly like a hang. Everything is
    written and the devices are back the way they were by the time this runs.
  */
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`\n${error.message}\n`);
  process.exit(1);
});
