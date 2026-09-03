import { Capacitor } from '@capacitor/core';
import type { PlaybackEngine } from './types';
import { WebPlaybackEngine } from './web';
import { NativePlaybackEngine } from './native';

export type { PlaybackEngine, PlaybackState, PlaybackStatus } from './types';

// Engine selection lives here so the rest of the app imports one thing.
//
// iOS runs the native AVPlayer engine (real volume + MPNowPlayingInfoCenter, the
// surface CarPlay attaches to later). Everything else — web, PWA, and the Android
// webview for now — stays on the <audio> + Media Session engine. Android gets its
// own native engine (Media3 ExoPlayer) once the Kotlin side lands; until then the
// webview path keeps working. Nothing else in the app changes across the branch.
export function createPlaybackEngine(): PlaybackEngine {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') {
    return new NativePlaybackEngine();
  }
  return new WebPlaybackEngine();
}
