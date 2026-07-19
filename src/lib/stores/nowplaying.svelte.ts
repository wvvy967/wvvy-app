import { parseNowPlaying, type NowPlayingData, type RawResponse } from '../azuracast';
import { NOWPLAYING_API_URL } from '../station';

// Poll cadence. AzuraCast recomputes now-playing every ~15s, so 30s in the
// foreground stays fresh without hammering. Backgrounded, we stop entirely and
// refetch on resume — a phone in a pocket doesn't need a metadata feed.
const POLL_MS = 30_000;

const EMPTY: NowPlayingData = {
  nowPlaying: { artist: '', title: '' },
  playingNext: null,
  history: [],
  live: { isLive: false, streamer: '' },
  bitrate: null,
  format: null,
  elapsed: 0,
  duration: 0
};

class NowPlayingStore {
  data = $state<NowPlayingData>(EMPTY);
  loading = $state(false);
  // Only set after a fetch has actually failed — a pending first load shouldn't
  // render as an error.
  error = $state<string | null>(null);

  #timer: ReturnType<typeof setInterval> | null = null;
  #controller: AbortController | null = null;

  async fetchOnce(): Promise<void> {
    // Supersede any in-flight request so a slow response can't clobber a newer one.
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;
    this.loading = true;
    try {
      const res = await fetch(NOWPLAYING_API_URL, {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.json()) as RawResponse;
      this.data = parseNowPlaying(raw);
      this.error = null;
    } catch (err) {
      // An abort is us replacing the request, not a failure — leave state alone.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      this.error = err instanceof Error ? err.message : 'metadata unavailable';
    } finally {
      if (this.#controller === controller) {
        this.loading = false;
        this.#controller = null;
      }
    }
  }

  /** Start polling. Returns a teardown. Safe to call once from the layout. */
  start(): () => void {
    if (typeof window === 'undefined') return () => {};
    void this.fetchOnce();
    this.#timer = setInterval(() => void this.fetchOnce(), POLL_MS);
    document.addEventListener('visibilitychange', this.#onVisibility);
    return () => this.stop();
  }

  #onVisibility = () => {
    if (document.visibilityState === 'visible') {
      // Whatever we last showed is now up to POLL_MS stale — refresh immediately
      // and restart the cadence from this moment.
      void this.fetchOnce();
      if (!this.#timer) this.#timer = setInterval(() => void this.fetchOnce(), POLL_MS);
    } else if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  };

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#controller?.abort();
    this.#controller = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.#onVisibility);
    }
  }
}

export const nowPlaying = new NowPlayingStore();
