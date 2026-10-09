// Light / dark theme, in three settings: 'system' follows the OS
// (prefers-color-scheme), 'light' and 'dark' pin it. The choice persists in
// localStorage under `wvvy:theme`. The inline script in app.html applies the
// resolved theme before first paint (no flash); this store owns it from mount
// on — re-applying, reacting to the OS flipping while on 'system', driving the
// native status bar, and backing <ThemeToggle>. Palette inversion itself lives
// in app.css (html.light).

import { applyThemeChrome } from '#lib/native.js';

export type ThemePref = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'wvvy:theme';

// Page background per theme. Kept in sync with app.html's inline script,
// native.ts (Android status-bar background) and the <meta name="theme-color">.
const THEME_BG: Record<ResolvedTheme, string> = {
  dark: '#0a0908',
  light: '#ece4d3'
};

function isPref(value: string | null): value is ThemePref {
  return value === 'system' || value === 'light' || value === 'dark';
}

function readPref(): ThemePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isPref(stored)) return stored;
  } catch {
    /* storage disabled — fall through to system */
  }
  return 'system';
}

function prefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

class Theme {
  /** What the user picked. */
  pref = $state<ThemePref>(readPref());

  // Tracks the OS preference so `resolved` recomputes when it flips under us.
  #systemDark = $state(prefersDark());

  /** The theme actually showing right now. */
  resolved = $derived<ResolvedTheme>(this.pref === 'system' ? (this.#systemDark ? 'dark' : 'light') : this.pref);

  /** Change the setting, persist it, and repaint. */
  set(pref: ThemePref): void {
    this.pref = pref;
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      /* best-effort */
    }
    this.apply();
  }

  /** Push the resolved theme onto <html>, the meta tag, and native chrome. */
  apply(): void {
    if (typeof document === 'undefined') return;
    const mode = this.resolved;
    const root = document.documentElement;
    root.classList.toggle('dark', mode === 'dark');
    root.classList.toggle('light', mode === 'light');
    // The inline style attribute on <html> would otherwise win over app.css.
    root.style.backgroundColor = THEME_BG[mode];
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BG[mode]);
    void applyThemeChrome(mode);
  }

  /**
   * Apply once and start listening for OS changes (only meaningful while on
   * 'system'). Returns an unsubscribe for onMount cleanup.
   */
  init(): () => void {
    this.apply();
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent): void => {
      this.#systemDark = e.matches;
      this.apply();
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }
}

export const theme = new Theme();
