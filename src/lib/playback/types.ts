import type { Track } from '../azuracast';

// The boundary between the UI and however audio actually gets played.
//
// Why this exists: CarPlay and Android Auto cannot see an HTML <audio> element.
// CarPlay renders native templates driven by MPNowPlayingInfoCenter, and Android
// Auto reads a Media3 MediaLibraryService. Both require playback to live in
// native code with a real media session behind it.
//
// So the UI never touches an audio element directly — it talks to this
// interface. Today the only implementation is WebPlaybackEngine (<audio> +
// MediaSession), which covers web, PWA, and the Capacitor webview including
// lock-screen controls. When the native engine lands, it slots in behind the
// same interface and the UI is untouched.

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'reconnecting' | 'error';

export type PlaybackState = {
  status: PlaybackStatus;
  // Whether the listener has asked for audio, independent of whether bytes are
  // currently flowing. A dropped stream mid-reconnect is still "wanted".
  wantPlay: boolean;
  error: string | null;
  volume: number;
  // False where the platform reserves volume for hardware buttons (iOS), so the
  // UI can hide a slider that would silently do nothing.
  canSetVolume: boolean;
};

export type PlaybackListener = (state: PlaybackState) => void;

export interface PlaybackEngine {
  /** Current snapshot. Callers should prefer subscribe() for live updates. */
  getState(): PlaybackState;

  /** Register for state changes. Returns an unsubscribe function. */
  subscribe(listener: PlaybackListener): () => void;

  /** Start playback, or stop it if already started. */
  toggle(): Promise<void>;

  /** Explicit start/stop, for lock-screen and remote commands. */
  play(): Promise<void>;
  stop(): void;

  /** 0..1. No-ops where canSetVolume is false. */
  setVolume(v: number): void;

  /**
   * Push now-playing metadata to whatever surface the platform exposes —
   * lock screen, notification, Bluetooth head unit, CarPlay. Called whenever
   * the AzuraCast poller reports a track change.
   */
  updateMetadata(track: Track | null | undefined): void;

  /** Release listeners and timers. */
  destroy(): void;
}
