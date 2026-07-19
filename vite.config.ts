/// <reference types="vitest/config" />

import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
      },

      // Capacitor ships a static bundle inside the native webview — there is no
      // server at runtime, so every route is prerendered to its own file. No
      // fallback: it would overwrite the prerendered index.html with an empty
      // shell, and with every route prerendered there is nothing to fall back to.
      adapter: adapter(),

      // Native webviews load from capacitor:// (iOS) or http://localhost
      // (Android); absolute asset paths break there, so keep everything relative.
      paths: { relative: true }
    }),
    svelteTesting(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
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
        start_url: '.',
        scope: '.',
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
        navigateFallback: 'index.html',
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
    })
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
