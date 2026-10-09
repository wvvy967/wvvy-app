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

/**
 * Match the native status bar to the active theme. Light theme → dark status-bar
 * icons on a paper background; dark theme → light icons on ink. Called by the
 * theme store whenever the resolved theme changes. Safe (no-op) on web. Keep the
 * background hexes in sync with THEME_BG in theme.svelte.ts.
 */
export async function applyThemeChrome(mode: 'light' | 'dark'): Promise<void> {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    // Style.Dark = light icons (for a dark bg); Style.Light = dark icons.
    await StatusBar.setStyle({ style: mode === 'dark' ? Style.Dark : Style.Light });
    if (platform() === 'android') {
      await StatusBar.setBackgroundColor({ color: mode === 'dark' ? '#0a0908' : '#ece4d3' });
    }
  } catch {
    // A missing plugin shouldn't take the app down — chrome is cosmetic.
  }
}

/** Splash + Android edge-to-edge. Safe to call on web, where it does nothing. */
export async function initNativeShell(): Promise<void> {
  if (!isNative()) return;
  try {
    if (platform() === 'android') {
      const { StatusBar } = await import('@capacitor/status-bar');
      // Draw behind the status bar so the background runs edge to edge; the
      // safe-area padding in app.css keeps content clear. The style/colour
      // themselves are set by applyThemeChrome via the theme store.
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
