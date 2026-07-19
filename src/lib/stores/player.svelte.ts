import { createPlaybackEngine } from '../playback';
import type { PlaybackEngine, PlaybackState } from '../playback';
import type { Track } from '../azuracast';

// Thin reactive wrapper over the playback engine. Holds no playback logic of its
// own — it mirrors engine state into runes so components can read it directly.
class PlayerStore {
  #engine: PlaybackEngine | null = null;
  #unsubscribe: (() => void) | null = null;

  state = $state<PlaybackState>({
    status: 'idle',
    wantPlay: false,
    error: null,
    volume: 0.85,
    canSetVolume: true
  });

  // Derived conveniences so templates read cleanly.
  get isPlaying() {
    return this.state.status === 'playing';
  }
  get isBusy() {
    return this.state.status === 'loading' || this.state.status === 'reconnecting';
  }
  get error() {
    return this.state.error;
  }
  get volume() {
    return this.state.volume;
  }
  get canSetVolume() {
    return this.state.canSetVolume;
  }
  // The button reflects intent, not byte flow — otherwise it flips back to
  // "play" during every reconnect and invites a double-tap that stops the stream.
  get showsPause() {
    return this.state.wantPlay;
  }

  /** Called once from the root layout, client-side only. Returns a teardown. */
  init(): () => void {
    if (this.#engine) return () => {};
    this.#engine = createPlaybackEngine();
    this.#unsubscribe = this.#engine.subscribe((s) => {
      this.state = s;
    });
    return () => this.destroy();
  }

  async toggle() {
    await this.#engine?.toggle();
  }

  setVolume(v: number) {
    this.#engine?.setVolume(v);
  }

  updateMetadata(track: Track | null | undefined) {
    this.#engine?.updateMetadata(track);
  }

  // Space toggles play/pause from anywhere. Skipped while the listener is typing
  // or focused on a control that has its own space behaviour. Returns a teardown.
  bindKeyboard(): () => void {
    if (typeof window === 'undefined') return () => {};
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName))) return;
      e.preventDefault();
      void this.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }

  destroy() {
    this.#unsubscribe?.();
    this.#engine?.destroy();
    this.#unsubscribe = null;
    this.#engine = null;
  }
}

export const player = new PlayerStore();
