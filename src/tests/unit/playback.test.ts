import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebPlaybackEngine } from '$lib/playback/web';
import type { PlaybackState } from '$lib/playback';

// Reaches into the engine's private audio element. Tests need to simulate the
// media events the real network would produce (playing / error / stalled),
// which is the only way to exercise the reconnect path.
function audioOf(engine: WebPlaybackEngine): HTMLAudioElement {
  return (engine as unknown as { audio: HTMLAudioElement }).audio;
}

describe('WebPlaybackEngine', () => {
  let engine: WebPlaybackEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new WebPlaybackEngine();
  });

  afterEach(() => {
    engine.destroy();
    vi.useRealTimers();
  });

  it('starts idle and not wanting playback', () => {
    const s = engine.getState();
    expect(s.status).toBe('idle');
    expect(s.wantPlay).toBe(false);
    expect(s.error).toBeNull();
  });

  it('emits the current state immediately on subscribe', () => {
    const seen: PlaybackState[] = [];
    engine.subscribe((s) => seen.push(s));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.status).toBe('idle');
  });

  it('stops notifying after unsubscribe', () => {
    const seen: PlaybackState[] = [];
    const off = engine.subscribe((s) => seen.push(s));
    off();
    engine.setVolume(0.4);
    expect(seen).toHaveLength(1);
  });

  it('marks wantPlay on play and clears it on stop', async () => {
    await engine.play();
    expect(engine.getState().wantPlay).toBe(true);

    engine.stop();
    const s = engine.getState();
    expect(s.wantPlay).toBe(false);
    expect(s.status).toBe('idle');
  });

  // A paused <audio> keeps the socket open and keeps pulling bytes the listener
  // isn't hearing, so stop() must drop the source outright.
  it('releases the stream connection on stop', async () => {
    await engine.play();
    engine.stop();
    expect(audioOf(engine).getAttribute('src')).toBeNull();
  });

  it('reports playing once audio actually flows', async () => {
    await engine.play();
    audioOf(engine).dispatchEvent(new Event('playing'));
    expect(engine.getState().status).toBe('playing');
  });

  it('persists volume and clamps out-of-range input', () => {
    engine.setVolume(0.25);
    expect(engine.getState().volume).toBe(0.25);
    expect(localStorage.getItem('wvvy:volume')).toBe('0.25');

    engine.setVolume(1.8);
    expect(engine.getState().volume).toBe(1);
    engine.setVolume(-3);
    expect(engine.getState().volume).toBe(0);
  });

  it('restores persisted volume on construction', () => {
    localStorage.setItem('wvvy:volume', '0.33');
    const fresh = new WebPlaybackEngine();
    expect(fresh.getState().volume).toBe(0.33);
    fresh.destroy();
  });

  it('ignores a corrupt persisted volume', () => {
    localStorage.setItem('wvvy:volume', 'not-a-number');
    const fresh = new WebPlaybackEngine();
    expect(fresh.getState().volume).toBe(0.85);
    fresh.destroy();
  });

  describe('reconnect', () => {
    it('retries with backoff after an unrequested drop', async () => {
      vi.useFakeTimers();
      await engine.play();
      audioOf(engine).dispatchEvent(new Event('playing'));

      audioOf(engine).dispatchEvent(new Event('error'));
      expect(engine.getState().status).toBe('reconnecting');
      // Still wanted — the listener didn't ask for this.
      expect(engine.getState().wantPlay).toBe(true);
    });

    it('gives up and reports off air after repeated failures', async () => {
      vi.useFakeTimers();
      await engine.play();

      // Six failures exhausts MAX_RECONNECT_ATTEMPTS; the seventh gives up.
      for (let i = 0; i < 7; i++) {
        audioOf(engine).dispatchEvent(new Event('error'));
        await vi.runOnlyPendingTimersAsync();
      }

      const s = engine.getState();
      expect(s.status).toBe('error');
      expect(s.error).toMatch(/off air/);
      expect(s.wantPlay).toBe(false);
    });

    it('does not reconnect after a listener-requested stop', async () => {
      await engine.play();
      engine.stop();
      audioOf(engine).dispatchEvent(new Event('error'));
      expect(engine.getState().status).toBe('idle');
    });
  });

  describe('media session metadata', () => {
    it('publishes track metadata to the lock screen', () => {
      engine.updateMetadata({ artist: 'Wire', title: 'Outdoor Miner', album: 'Chairs Missing' });
      const meta = navigator.mediaSession.metadata as unknown as { title: string; artist: string; album: string };
      expect(meta.title).toBe('Outdoor Miner');
      expect(meta.artist).toBe('Wire');
    });

    it('falls back to the station name when the track has no artist', () => {
      engine.updateMetadata({ artist: '', title: '' });
      const meta = navigator.mediaSession.metadata as unknown as { title: string; artist: string };
      expect(meta.title).toBe('Live Stream');
      expect(meta.artist).toContain('WVVY');
    });

    // The poller reassigns its data every tick, so this is called constantly.
    it('skips redundant updates for an unchanged track', () => {
      engine.updateMetadata({ artist: 'Wire', title: 'Outdoor Miner' });
      const first = navigator.mediaSession.metadata;
      engine.updateMetadata({ artist: 'Wire', title: 'Outdoor Miner' });
      expect(navigator.mediaSession.metadata).toBe(first);

      engine.updateMetadata({ artist: 'Slint', title: 'Nosferatu Man' });
      expect(navigator.mediaSession.metadata).not.toBe(first);
    });
  });
});
