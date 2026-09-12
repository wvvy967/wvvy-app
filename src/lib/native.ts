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

/**
 * Open a URL in the device's *default* browser (Safari/Chrome), fully leaving the
 * app — unlike openExternal, which stays in an in-app browser. Donation links use
 * this so the payment is unambiguously handled outside the app (App Store Review
 * Guideline 3.1.1: donations to our 501(c)(3) are collected in the browser, not
 * in-app).
 *
 * On native, `window.open(_, '_blank')` is caught by Capacitor's WKWebView
 * delegate and routed to UIApplication.open — the system browser — rather than a
 * new webview. Background audio keeps playing, so the stream isn't interrupted.
 * On web it's a normal new tab.
 */
export function openInSystemBrowser(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}
