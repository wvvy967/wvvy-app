import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { PlaybackEngine, PlaybackListener, PlaybackState, PlaybackStatus } from './types';
import type { Track } from '../azuracast';
import { STATION, storageKeys, streamUrl } from '../station';

// Native playback engine, used on iOS. It drives the WvvyPlayer Capacitor plugin
// (ios/App/App/WvvyPlayer.swift) — an AVPlayer publishing to
// MPNowPlayingInfoCenter — instead of an HTML <audio> element.
//
// Why this exists at all: HTMLMediaElement.volume is a silent no-op in WKWebView
// on iOS, so the web engine can't offer any volume control there. This engine
// runs AVPlayer at full gain and leaves volume to the native system-volume
// slider (capacitor-plugin-system-volume), so the hardware buttons and the
// on-screen slider stay in sync — hence canSetVolume is false here.
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
  load(options: { url: string; volume: number }): Promise<void>;
  stop(): Promise<void>;
  setVolume(options: { volume: number }): Promise<void>;
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
  private lastMetadataKey: string | null = null;

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
      // native players are especially prone to.
      await WvvyPlayer.load({ url: streamUrl(), volume: this.state.volume });
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

  updateMetadata(track: Track | null | undefined): void {
    const artist = (track?.artist ?? '').trim();
    const title = (track?.title ?? '').trim() || 'Live Stream';
    // The poller reassigns its data wholesale every tick, so skip the native
    // round-trip when the track hasn't actually moved.
    const key = `${artist}|${title}`;
    if (key === this.lastMetadataKey) return;
    this.lastMetadataKey = key;
    void WvvyPlayer.updateNowPlaying({
      title,
      artist: artist || STATION.name,
      album: track?.album?.trim() || `${STATION.name} · ${STATION.location}`,
      // Absolute URL only — the native side fetches it directly, so a relative
      // fallback icon wouldn't resolve. Omit when there's no art.
      artworkUrl: track?.art?.trim() || undefined
    });
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
