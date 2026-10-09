// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
/// <reference types="vite-plugin-pwa/client" />

declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  /** Release version, from the git tag; see `appVersion` in vite.config.ts. */
  const __APP_VERSION__: string;

  /** Short commit this bundle was built from; see `gitCommit` in vite.config.ts. */
  const __GIT_SHA__: string;
}

export {};
