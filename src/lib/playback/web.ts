import type { PlaybackEngine, PlaybackListener, PlaybackState, PlaybackStatus } from './types';
import type { Track } from '../azuracast';
import { STATION, storageKeys, streamUrl } from '../station';

// HTML <audio> + the Media Session API. Covers web, installed PWA, and the
// Capacitor webview — on both platforms this drives the real lock-screen
// controls once the native background-audio config is in place (see
// docs/native-audio.md). Swap in a native engine later for CarPlay/Auto without
// touching the UI; see ./types.ts for why that boundary exists.

const FALLBACK_ART = [
  { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
];

// ~35s of backoff (1+2+4+8+10+10) before giving up. Beyond that it's almost
// certainly the transmitter, not a flaky network — bail and tell the listener.
const MAX_RECONNECT_ATTEMPTS = 6;

function loadVolume(): number {
  if (typeof localStorage === 'undefined') return 0.85;
  const raw = localStorage.getItem(storageKeys.volume);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.85;
}

// iOS reserves media volume for the hardware buttons. It still lets JS read and
// write HTMLMediaElement.volume — the value even sticks on read-back — but the
// write has no audible effect, and the Web Audio GainNode workaround doesn't
// help either (WebKit won't reroute a streaming <audio> element into the graph).
// The limitation isn't observable via any property, so key off the platform.
function detectCanSetVolume(): boolean {
  if (typeof navigator === 'undefined') return true;
  const ua = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return !isIOS;
}

export class WebPlaybackEngine implements PlaybackEngine {
  private listeners = new Set<PlaybackListener>();
  private audio: HTMLAudioElement | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private lastMetadataKey: string | null = null;

  private state: PlaybackState = {
    status: 'idle',
    wantPlay: false,
    error: null,
    volume: loadVolume(),
    canSetVolume: true
  };

  constructor() {
    if (typeof window === 'undefined') return;
    this.state.canSetVolume = detectCanSetVolume();
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    this.initMediaSession();
  }

  getState(): PlaybackState {
    return { ...this.state };
  }

  subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private patch(next: Partial<PlaybackState>) {
    this.state = { ...this.state, ...next };
    const snapshot = this.getState();
    for (const l of this.listeners) l(snapshot);
  }

  private setStatus(status: PlaybackStatus, error: string | null = null) {
    this.patch({ status, error });
    this.setPlaybackState(status === 'playing' ? 'playing' : this.state.wantPlay ? 'playing' : 'paused');
  }

  // --- Media Session (lock screen / notification / Bluetooth head unit) ---

  private initMediaSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', () => void this.play());
    navigator.mediaSession.setActionHandler('pause', () => this.stop());
    navigator.mediaSession.setActionHandler('stop', () => this.stop());
    // A live stream has no timeline — declining these keeps scrub controls off
    // the lock screen and out of the car head unit.
    for (const action of ['seekbackward', 'seekforward', 'previoustrack', 'nexttrack'] as const) {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch {
        // Not every browser knows every action; ignore the ones it rejects.
      }
    }
  }

  private setPlaybackState(state: MediaSessionPlaybackState) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = state;
  }

  updateMetadata(track: Track | null | undefined) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const artist = (track?.artist ?? '').trim();
    const title = (track?.title ?? '').trim() || 'Live Stream';
    // The poller reassigns its data wholesale every tick, so this fires on every
    // poll. Skip the MediaMetadata churn when the track hasn't moved.
    const key = `${artist}|${title}`;
    if (key === this.lastMetadataKey) return;
    this.lastMetadataKey = key;
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: artist || STATION.name,
      album: track?.album?.trim() || `${STATION.name} · ${STATION.location}`,
      artwork: track?.art ? [{ src: track.art }, ...FALLBACK_ART] : FALLBACK_ART
    });
  }

  // --- Network ---

  private handleOnline = () => {
    if (this.state.error === 'offline — no network connection') this.patch({ error: null });
    // The listener asked to play before the network dropped — retry now rather
    // than waiting out the backoff timer.
    if (this.state.wantPlay) {
      this.clearReconnect();
      this.reconnectAttempts = 0;
      void this.start();
    }
  };

  private handleOffline = () => {
    this.clearReconnect();
    if (this.state.wantPlay) this.setStatus('error', 'offline — no network connection');
  };

  private clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // --- Audio element ---

  private ensure(): HTMLAudioElement {
    if (this.audio) return this.audio;
    const el = new Audio();
    el.preload = 'none';
    // Tells the platform this is continuous playback, not a UI sound effect.
    el.setAttribute('playsinline', '');
    el.addEventListener('playing', () => {
      this.reconnectAttempts = 0;
      this.setStatus('playing');
    });
    el.addEventListener('ended', () => this.handleDrop());
    el.addEventListener('error', () => this.handleDrop());
    el.addEventListener('stalled', () => this.handleDrop());
    this.audio = el;
    return el;
  }

  // Long-lived stream connections drop mid-song (network blips, upstream
  // restarts, mobile backgrounding). Auto-reconnect on any drop the listener
  // didn't ask for, with backoff so a dead upstream doesn't get hammered.
  private handleDrop() {
    if (!this.state.wantPlay) {
      this.setStatus('idle');
      return;
    }
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.clearReconnect();
      this.reconnectAttempts = 0;
      this.patch({ wantPlay: false });
      this.setStatus('error', 'station appears to be off air — try again later');
      return;
    }
    this.clearReconnect();
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10_000);
    this.reconnectAttempts++;
    this.setStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => void this.start(), delay);
  }

  private async start() {
    const audio = this.ensure();
    try {
      this.setStatus('loading');
      audio.volume = this.state.volume;
      // A fresh URL each attempt — a reused src can resume a stale buffer.
      audio.src = streamUrl();
      audio.load();
      await audio.play();
    } catch (err) {
      // Autoplay rejection is terminal for this gesture — retrying won't help
      // until the listener taps again, so surface it instead of looping.
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        this.patch({ wantPlay: false });
        this.setStatus('error', 'tap play to start audio');
        return;
      }
      this.handleDrop();
    }
  }

  async play(): Promise<void> {
    if (this.state.wantPlay) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.patch({ wantPlay: true });
      this.setStatus('error', 'offline — no network connection');
      return;
    }
    this.patch({ wantPlay: true, error: null });
    this.reconnectAttempts = 0;
    await this.start();
  }

  stop(): void {
    if (!this.state.wantPlay && this.state.status === 'idle') return;
    this.clearReconnect();
    this.reconnectAttempts = 0;
    this.patch({ wantPlay: false, error: null });
    if (this.audio) {
      this.audio.pause();
      // Drop the connection outright. Pause alone leaves the socket open and
      // keeps pulling bytes the listener isn't hearing.
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    this.setStatus('idle');
  }

  async toggle(): Promise<void> {
    if (this.state.wantPlay) this.stop();
    else await this.play();
  }

  setVolume(v: number): void {
    const clamped = Math.min(1, Math.max(0, v));
    this.patch({ volume: clamped });
    if (this.audio) this.audio.volume = clamped;
    if (typeof localStorage !== 'undefined') localStorage.setItem(storageKeys.volume, String(clamped));
  }

  destroy(): void {
    this.clearReconnect();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    this.audio?.pause();
    this.audio = null;
    this.listeners.clear();
  }
}
