import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Kit config lives in this file rather than inline in vite.config.ts because
// @vite-pwa/sveltekit reads svelte.config.js to discover the adapter's output
// directory — it needs to know where the prerendered HTML lands so it can
// precache it. With the config inline, the PWA plugin can't find it.

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    // Capacitor ships a static bundle inside the native webview — there is no
    // server at runtime, so every route is prerendered to its own file. No
    // fallback: it would overwrite the prerendered index.html with an empty
    // shell, and with every route prerendered there is nothing to fall back to.
    adapter: adapter(),

    // Native webviews load from capacitor:// (iOS) or http://localhost
    // (Android); absolute asset paths break there, so keep everything relative.
    paths: { relative: true }
  },
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
    runes: true
  }
};

export default config;
