import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { PlaybackEngine, PlaybackListener, PlaybackState, PlaybackStatus } from './types';
import type { Track } from '../azuracast';
import { NOWPLAYING_API_URL, STATION, storageKeys, streamUrl } from '../station';

// Native playback engine, used on both iOS and Android. It drives the WvvyPlayer
// Capacitor plugin — an AVPlayer publishing to MPNowPlayingInfoCenter on iOS
// (ios/App/App/WvvyPlayer.swift), a Media3 ExoPlayer in a MediaSessionService on
// Android (android/.../PlaybackService.kt) — instead of an HTML <audio> element.
// The plugin's JS surface is identical on both, so this one engine drives them
// without a platform branch (bar the Android-only adoptRunningPlayback below).
//
// Why this exists at all: HTMLMediaElement.volume is a silent no-op in WKWebView
// on iOS (and unreliable in the Android WebView), so the web engine can't offer a
// working volume control there. This engine runs the native player at full gain
// and leaves volume to the native system-volume slider (capacitor-plugin-system-volume)
// on both platforms — iOS via an MPVolumeView overlay, Android via a styled slider
// that calls the same plugin (see +page.svelte) — so the hardware buttons and the
// on-screen slider stay in sync. Hence canSetVolume is false and the app-gain path
// (setVolume below) goes unused on device; it stays only for parity/tests.
//
// The reconnect/backoff state machine below is intentionally parallel to
// WebPlaybackEngine's: the native plugin is a dumb transport that just reports
// "playing" / "ended" / "error", and all recovery policy lives here so both
// engines behave identically. Kept as a separate class for now rather than a
// shared base so the shipping web path is untouched while this is proven on a
// device; unify the two once it is. See ./types.ts for the interface contract.

// WvvyPlayer plugin surface — mirrors ios/App/App/WvvyPlayerPlugin.swift.
interface StateChangeEvent {
  state: 'playing' | 'buffering' | 'ended' | 'error';
  message?: string;
}
interface RemoteCommandEvent {
  command: 'play' | 'pause' | 'stop';
}
interface WvvyPlayerPlugin {
  // nowPlayingUrl + station labels let the native side poll the AzuraCast metadata
  // API itself and keep MPNowPlayingInfoCenter advancing while backgrounded, where
  // the JS poller can't run. Optional so an older native build still loads.
  load(options: { url: string; volume: number; nowPlayingUrl?: string; stationName?: string; stationDesc?: string }): Promise<void>;
  stop(): Promise<void>;
  setVolume(options: { volume: number }): Promise<void>;
  getState(): Promise<{ playing: boolean }>;
  updateNowPlaying(options: { title: string; artist: string; album: string; artworkUrl?: string }): Promise<void>;
  addListener(event: 'stateChange', cb: (e: StateChangeEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: 'remoteCommand', cb: (e: RemoteCommandEvent) => void): Promise<PluginListenerHandle>;
}

const WvvyPlayer = registerPlugin<WvvyPlayerPlugin>('WvvyPlayer');

// ~35s of backoff (1+2+4+8+10+10) before giving up — same budget as the web
// engine.
const MAX_RECONNECT_ATTEMPTS = 6;

export class NativePlaybackEngine implements PlaybackEngine {
  private listeners = new Set<PlaybackListener>();
  private pluginHandles: PluginListenerHandle[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;

  private state: PlaybackState = {
    status: 'idle',
    wantPlay: false,
    error: null,
    // AVPlayer runs at full gain; on iOS the volume control is the native
    // system-volume slider (capacitor-plugin-system-volume / MPVolumeView),
    // which drives the OS output volume and stays in sync with the hardware
    // buttons. So the app-gain path is unused here and canSetVolume is false —
    // the web <input> slider stays hidden and +page renders the native one.
    volume: 1,
    canSetVolume: false
  };

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    void this.bindPlugin();
    void this.adoptRunningPlayback();
  }

  // Background audio outlives the webview: on Android, closing and reopening the
  // app makes a fresh webview whose engine state starts idle, while the media
  // service may still be streaming. Ask the native side once at startup and adopt
  // a stream that's already playing, so the UI shows "Stop" over live audio rather
  // than a "Play" button that would start a second load. iOS keeps its webview, so
  // this is Android-only; the try/catch also covers a plugin without getState.
  private async adoptRunningPlayback() {
    if (Capacitor.getPlatform() !== 'android') return;
    try {
      const { playing } = await WvvyPlayer.getState();
      if (playing && !this.state.wantPlay) {
        this.reconnectAttempts = 0;
        this.patch({ wantPlay: true });
        this.setStatus('playing');
      }
    } catch {
      // No getState (older native build) or not playing — leave state idle.
    }
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
  }

  // --- Plugin events ---

  private async bindPlugin() {
    this.pluginHandles.push(
      await WvvyPlayer.addListener('stateChange', (e) => this.onPluginState(e)),
      // The lock screen / car head unit call back so this engine stays the single
      // source of truth for wantPlay — same reason the web engine wires up the
      // Media Session action handlers.
      await WvvyPlayer.addListener('remoteCommand', (e) => this.onRemoteCommand(e))
    );
  }

  private onPluginState(e: StateChangeEvent) {
    switch (e.state) {
      case 'playing':
        this.reconnectAttempts = 0;
        this.setStatus('playing');
        break;
      case 'ended':
      case 'error':
        this.handleDrop();
        break;
      // 'buffering' is informational — don't clobber a 'reconnecting' status.
    }
  }

  private onRemoteCommand(e: RemoteCommandEvent) {
    if (e.command === 'play') void this.play();
    else this.stop();
  }

  // --- Network ---

  private handleOnline = () => {
    if (this.state.error === 'offline — no network connection') this.patch({ error: null });
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

  // Long-lived stream connections drop mid-song (network blips, upstream
  // restarts). Auto-reconnect on any drop the listener didn't ask for, with
  // backoff so a dead upstream doesn't get hammered — mirrors the web engine.
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
    try {
      this.setStatus('loading');
      // A fresh URL each attempt — a reused src can resume a stale buffer, which
      // native players are especially prone to. The station labels match the
      // fallbacks updateMetadata applies, so the lock screen reads the same whether
      // the native poll or a foreground JS push wrote it last.
      await WvvyPlayer.load({
        url: streamUrl(),
        volume: this.state.volume,
        nowPlayingUrl: NOWPLAYING_API_URL,
        stationName: STATION.name,
        stationDesc: `${STATION.name} · ${STATION.location}`
      });
    } catch {
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
    void WvvyPlayer.stop();
    this.setStatus('idle');
  }

  async toggle(): Promise<void> {
    if (this.state.wantPlay) this.stop();
    else await this.play();
  }

  setVolume(v: number): void {
    const clamped = Math.min(1, Math.max(0, v));
    this.patch({ volume: clamped });
    void WvvyPlayer.setVolume({ volume: clamped });
    if (typeof localStorage !== 'undefined') localStorage.setItem(storageKeys.volume, String(clamped));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  updateMetadata(_track: Track | null | undefined): void {
    // Deliberately a no-op. Both native platforms poll the AzuraCast API from the
    // native player and own the OS media session directly — MPNowPlayingInfoCenter
    // on iOS (WvvyPlayer.swift), the MediaSession on Android (PlaybackService.kt) —
    // so the lock screen / car / Bluetooth keep advancing while the app is
    // backgrounded and this JS path is frozen. Pushing from here too would just be
    // a second, foreground-only writer racing the native poll. The station labels
    // the native side needs for its fallbacks are handed over once, in start().
    // Kept to satisfy the PlaybackEngine contract (the store still calls it).
  }

  destroy(): void {
    this.clearReconnect();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    for (const h of this.pluginHandles) void h.remove();
    this.pluginHandles = [];
    void WvvyPlayer.stop();
    this.listeners.clear();
  }
}
