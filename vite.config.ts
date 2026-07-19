/// <reference types="vitest/config" />

import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// Kit options (adapter, paths, runes) live in svelte.config.js — see the note
// there for why they can't be inline here.

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
    // SvelteKitPWA rather than plain VitePWA: the static adapter writes the
    // prerendered HTML after Vite's build finishes, so a plain Workbox glob runs
    // too early and precaches zero HTML — leaving the app broken offline. This
    // integration hooks the adapter's output instead.
    SvelteKitPWA({
      registerType: 'autoUpdate',
      // Registration happens in src/lib/pwa.ts so it can be skipped inside the
      // Capacitor shell, where a service worker only adds a stale-cache risk.
      injectRegister: null,
      manifestFilename: 'manifest.json',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'WVVY 96.7 LPFM',
        short_name: 'WVVY',
        description: 'Live community radio from Tisbury, Martha’s Vineyard.',
        theme_color: '#0a0908',
        background_color: '#0a0908',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['music', 'entertainment'],
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Any navigation that misses the precache falls back to the app shell,
        // which is what makes a client-routed SPA work offline.
        navigateFallback: '/',
        runtimeCaching: [
          {
            // The now-playing feed and the Icecast mount must always hit the
            // network — a cached "now playing" is worse than none, and a cached
            // audio response would replay stale stream bytes.
            urlPattern: ({ url }: { url: URL }) => url.hostname === 'radio.wvvy.org',
            handler: 'NetworkOnly'
          }
        ]
      },
      devOptions: { enabled: false }
    }),
    svelteTesting()
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/tests/unit/setup.ts',
    include: ['src/tests/unit/**/*.{test,spec}.{js,ts}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.{ts,svelte}'],
      exclude: ['src/tests/**'],
      thresholds: { lines: 70, functions: 70, statements: 70 }
    }
  }
});
