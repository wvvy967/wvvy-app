/*
  The half of the screenshot job that runs inside the app.

  It executes in the webview before the SvelteKit bundle does, and does two
  things: walk the app to one named screen through its own DOM, and tell the
  outside world when it has finished. Adapted from na-meetings-near-me — read
  that repo's tools/screenshots for the fuller reasoning.

  Why the DOM rather than taps: WVVY is a webview, so its own controls are
  reachable directly — a click on `nav a` stays correct when the layout moves.

  Why a blinking square: neither WKWebView console output nor any iOS debugging
  protocol reaches the driver, so the "am I finished?" signal is visual. While a
  scene runs, a square in the corner changes every 60ms, which guarantees two
  consecutive screenshots can never match; when the scene finishes the square is
  removed and the driver's "capture once two shots are identical" loop fires on a
  screen that is settled by definition. The square is gone before the shot.
*/
(function () {
  'use strict';

  var CONFIG = window.__SHOT_CONFIG || {};

  /* -------------------------------------------------------------------- seed */

  // The only state a WVVY shot needs: tell the player to render the styled web
  // volume slider instead of the native MPVolumeView, which is blank in the
  // simulator. Written now, in <head>, so +page.svelte reads it at first render.
  try {
    localStorage.setItem('wvvy:shot', '1');
  } catch {
    /* storage refused — the slider just renders empty; not worth aborting */
  }

  /* ------------------------------------------------------------- busy marker */

  var busyEl = null;
  var busyTimer = null;

  function startBusy() {
    if (busyEl) return;
    busyEl = document.createElement('div');
    busyEl.style.cssText = 'position:fixed;top:0;left:0;width:14px;height:14px;z-index:2147483647;pointer-events:none;background:#000';
    (document.body || document.documentElement).appendChild(busyEl);
    // A 24-bit counter, not a two-state flip: a marker with a period can line up
    // with the driver's sampling period and settle mid-scene. A counter cannot
    // repeat until it wraps (days away), so no two samples match while running.
    var tick = 0;
    busyTimer = setInterval(function () {
      tick = (tick + 1) % 0xffffff;
      busyEl.style.background = '#' + ('000000' + tick.toString(16)).slice(-6);
      busyEl.style.width = busyEl.style.height = 10 + (tick % 5) + 'px';
    }, 60);
  }

  function stopBusy() {
    if (busyTimer) clearInterval(busyTimer);
    busyTimer = null;
    if (busyEl && busyEl.parentNode) busyEl.parentNode.removeChild(busyEl);
    busyEl = null;
  }

  // A failed scene must keep MOVING (in red), never park on a solid colour — a
  // still screen is exactly what the driver captures, so a frozen marker would
  // photograph a broken screen. Moving means the driver times out and says so.
  function failBusy() {
    if (!busyEl) return;
    if (busyTimer) clearInterval(busyTimer);
    var tick = 0;
    busyTimer = setInterval(function () {
      tick = (tick + 1) % 0xff;
      busyEl.style.background = 'rgb(255,' + tick + ',' + tick + ')';
      busyEl.style.width = busyEl.style.height = 10 + (tick % 5) + 'px';
    }, 60);
  }

  /* ------------------------------------------------------------- DOM helpers */

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  async function waitFor(probe, label, timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 20000);
    for (;;) {
      var hit;
      try {
        hit = probe();
      } catch {
        hit = null;
      }
      if (hit) return hit;
      if (Date.now() > deadline) throw new Error('screenshot harness: timed out waiting for ' + label);
      await sleep(100);
    }
  }

  async function click(element, settleMs) {
    if (!element) throw new Error('screenshot harness: nothing to click');
    element.click();
    await sleep(settleMs == null ? 600 : settleMs);
  }

  // Freeze every CSS animation/transition so the page can actually go
  // byte-identical between two frames. Without this the "On Air" dot pulses
  // forever (and the album-art equaliser animates while playing), so the driver
  // — which captures only once two shots match — never settles. Called at the
  // end of each scene, just before the busy marker stops.
  function freezeAnimations() {
    var style = document.createElement('style');
    style.textContent = '*,*::before,*::after{animation:none !important;transition:none !important;caret-color:transparent !important}';
    (document.head || document.documentElement).appendChild(style);
  }

  // The four bottom-bar destinations, in the order +layout.svelte declares them:
  // Listen, Schedule, Support, About. Indexed rather than matched on href
  // because `paths.relative` rewrites them per route; matched on count so a
  // reordered or resized bar stops the run instead of shooting the wrong screen.
  var TABS = { listen: 0, schedule: 1, support: 2, about: 3 };

  async function openTab(name) {
    var links = await waitFor(function () {
      var found = document.querySelectorAll('nav a');
      return found.length ? found : null;
    }, 'the bottom navigation bar');
    if (links.length !== 4) {
      throw new Error('screenshot harness: expected 4 bottom-bar destinations, found ' + links.length);
    }
    await click(links[TABS[name]], 900);
    await waitFor(function () {
      return document.querySelectorAll('nav a[aria-current="page"]')[0] === links[TABS[name]];
    }, 'the ' + name + ' tab to become current');
  }

  /* ------------------------------------------------------------------ scenes */

  var scenes = {
    // The screen the app opens on: album art, now playing, transport, volume.
    async player() {
      await openTab('listen');
      // The play/stop control is the anchor for "the player has rendered".
      await waitFor(function () {
        return document.querySelector('button[aria-label$="the live stream"]');
      }, 'the play control');
      // Live now-playing + cover art arrive over the network; let them land.
      await sleep(4500);
    },

    // The weekly schedule: today first, the whole week on one screen.
    async schedule() {
      await openTab('schedule');
      // A day heading (h2) means the schedule has rendered its first section.
      await waitFor(function () {
        return document.querySelector('section h2');
      }, 'the schedule to render');
      // The live sheet may replace the static fallback a beat later.
      await sleep(3000);
    }
  };

  /* ------------------------------------------------------------------ runner */

  async function run(name) {
    var scene = scenes[name];
    if (!scene) throw new Error('screenshot harness: no scene named "' + name + '"');
    startBusy();
    try {
      await scene();
      freezeAnimations();
      // A beat for the freeze to take and any final layout to settle.
      await sleep(300);
    } catch (error) {
      failBusy();
      throw error;
    }
    stopBusy();
    return name;
  }

  window.__shot = { run: run, scenes: Object.keys(scenes) };

  // iOS bakes the scene name in and the page starts itself (no debugging
  // protocol to drive it from outside).
  if (CONFIG.scene) {
    startBusy();
    window.addEventListener('load', function () {
      run(CONFIG.scene).catch(function (error) {
        failBusy();
        // Surfaced where a human watching the simulator can read it, since this
        // webview's console reaches nothing on iOS.
        var note = document.createElement('pre');
        note.style.cssText = 'position:fixed;inset:auto 0 0 0;z-index:2147483646;margin:0;padding:8px;background:#f00;color:#fff;font:12px monospace;white-space:pre-wrap';
        note.textContent = String(error && error.message ? error.message : error);
        (document.body || document.documentElement).appendChild(note);
      });
    });
  }
})();
