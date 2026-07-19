import { isNative } from './native';

// Service-worker registration.
//
// vite-plugin-pwa's `injectRegister` writes a script tag into the index.html it
// generates — but SvelteKit builds its HTML from src/app.html and replaces that
// file, so the injection is silently dropped. Registering here from the client
// is what actually makes the app installable and offline-capable.
//
// Web only. Inside the Capacitor shell the bundle is already on the device and
// is served from capacitor:// (iOS) or http://localhost (Android); a service
// worker adds nothing there and only introduces another cache layer that can
// serve a stale build after an app update.
export async function registerPWA(): Promise<void> {
  if (isNative()) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({
      // The app shell is small and the station data is all network-first, so
      // there's no reason to sit on an old build waiting for a tab close.
      immediate: true
    });
  } catch {
    // A failed registration costs offline support, not the app — an install
    // prompt that never appears beats a blank screen.
  }
}
