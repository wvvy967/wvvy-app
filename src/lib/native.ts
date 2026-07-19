import { Capacitor } from '@capacitor/core';

// Capacitor-only concerns, kept behind guards so the same bundle runs on the web
// untouched. Every import here is dynamic — pulling the native plugins into the
// web bundle would ship code that can never run.

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export function platform(): 'ios' | 'android' | 'web' {
  return Capacitor.getPlatform() as 'ios' | 'android' | 'web';
}

/** Status bar + splash. Safe to call on web, where it does nothing. */
export async function initNativeShell(): Promise<void> {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    if (platform() === 'android') {
      await StatusBar.setBackgroundColor({ color: '#0a0908' });
      // Draw behind the status bar so the ink background runs edge to edge; the
      // safe-area padding in app.css keeps content clear.
      await StatusBar.setOverlaysWebView({ overlay: true });
    }
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch {
    // A missing plugin shouldn't take the app down — chrome is cosmetic.
  }
}

/**
 * Open a URL outside the app. Native uses the in-app browser so the listener
 * keeps their place (and audio keeps playing); web falls back to a new tab.
 */
export async function openExternal(url: string): Promise<void> {
  if (!isNative()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url, presentationStyle: 'popover' });
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
