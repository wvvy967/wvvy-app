import '@testing-library/jest-dom/vitest';

// jsdom implements neither the Media Session API nor real audio playback, so the
// playback engine would throw on construction. Stub just enough surface for the
// engine's calls to be observable in tests.
if (!('mediaSession' in navigator)) {
  Object.defineProperty(navigator, 'mediaSession', {
    writable: true,
    value: {
      metadata: null,
      playbackState: 'none',
      setActionHandler: () => {}
    }
  });
}

if (!('MediaMetadata' in globalThis)) {
  // @ts-expect-error — minimal stand-in for the real constructor.
  globalThis.MediaMetadata = class {
    title: string;
    artist: string;
    album: string;
    artwork: unknown[];
    constructor(init: { title?: string; artist?: string; album?: string; artwork?: unknown[] } = {}) {
      this.title = init.title ?? '';
      this.artist = init.artist ?? '';
      this.album = init.album ?? '';
      this.artwork = init.artwork ?? [];
    }
  };
}

// jsdom's HTMLMediaElement throws "Not implemented" on play/load.
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  writable: true,
  value: () => Promise.resolve()
});
Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
  writable: true,
  value: () => {}
});
Object.defineProperty(HTMLMediaElement.prototype, 'load', {
  writable: true,
  value: () => {}
});
