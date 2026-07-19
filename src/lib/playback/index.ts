import type { PlaybackEngine } from './types';
import { WebPlaybackEngine } from './web';

export type { PlaybackEngine, PlaybackState, PlaybackStatus } from './types';

// Engine selection lives here so the rest of the app imports one thing.
//
// When the native engine lands (AVPlayer on iOS / Media3 ExoPlayer on Android,
// exposed through a Capacitor plugin — the prerequisite for CarPlay and Android
// Auto), this becomes a Capacitor.isNativePlatform() branch and nothing else in
// the app changes.
export function createPlaybackEngine(): PlaybackEngine {
  return new WebPlaybackEngine();
}
