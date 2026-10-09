import { describe, test, expect, beforeEach, vi } from 'vitest';

// matchMedia isn't in jsdom. Report "OS prefers light" so 'system' resolves to
// light. Must be defined before the theme store module is imported, since its
// singleton reads the preference at construction.
vi.stubGlobal(
  'matchMedia',
  vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
);

const { theme } = await import('#lib/theme.svelte.js');

describe('theme store', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    if (!document.querySelector('meta[name="theme-color"]')) {
      const meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    theme.set('system');
  });

  test('pinning dark applies the .dark class and ink background', () => {
    theme.set('dark');
    expect(theme.resolved).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(document.documentElement.style.backgroundColor).toBe('rgb(10, 9, 8)'); // #0a0908
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#0a0908');
  });

  test('pinning light applies the .light class and paper background', () => {
    theme.set('light');
    expect(theme.resolved).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.backgroundColor).toBe('rgb(236, 228, 211)'); // #ece4d3
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#ece4d3');
  });

  test('system follows the OS preference (mocked to light)', () => {
    theme.set('system');
    expect(theme.resolved).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  test('the chosen setting is persisted to localStorage', () => {
    theme.set('dark');
    expect(localStorage.getItem('wvvy:theme')).toBe('dark');
    theme.set('system');
    expect(localStorage.getItem('wvvy:theme')).toBe('system');
  });
});
