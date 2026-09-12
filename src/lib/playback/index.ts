import { Capacitor } from '@capacitor/core';
import type { PlaybackEngine } from './types';
import { WebPlaybackEngine } from './web';
import { NativePlaybackEngine } from './native';

export type { PlaybackEngine, PlaybackState, PlaybackStatus } from './types';

// Engine selection lives here so the rest of the app imports one thing.
//
// Both native platforms now run the native engine behind the WvvyPlayer plugin:
// iOS on AVPlayer (ios/App/App/WvvyPlayer.swift), Android on Media3 ExoPlayer
// (android/.../PlaybackService.kt). Both publish a real media session — the
// surface the lock screen, CarPlay and Android Auto attach to — and both give a
// working volume control, which the webview's <audio> cannot on either OS. Web
// and the installed PWA stay on the <audio> + Media Session engine.
export function createPlaybackEngine(): PlaybackEngine {
  if (Capacitor.isNativePlatform()) {
    const platform = Capacitor.getPlatform();
    if (platform === 'ios' || platform === 'android') return new NativePlaybackEngine();
  }
  return new WebPlaybackEngine();
}
