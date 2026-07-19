<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { Radio, CalendarDays, HeartHandshake, Info } from '@lucide/svelte';
  import { player } from '$lib/stores/player.svelte';
  import { nowPlaying } from '$lib/stores/nowplaying.svelte';
  import { initNativeShell, isNative } from '$lib/native';
  import { registerPWA } from '$lib/pwa';

  let { children } = $props();

  // resolve() applies the configured base path, which matters in the native
  // webview where the bundle is not served from the domain root.
  const navItems = [
    { href: resolve('/'), icon: Radio, label: 'Listen', exact: true },
    { href: resolve('/schedule'), icon: CalendarDays, label: 'Schedule' },
    { href: resolve('/support'), icon: HeartHandshake, label: 'Support' },
    { href: resolve('/about'), icon: Info, label: 'About' }
  ];

  function isActive(item: { href: string; exact?: boolean }) {
    const path = page.url.pathname.replace(/\/$/, '');
    const href = item.href.replace(/\/$/, '');
    return item.exact ? path === href : path.startsWith(href);
  }

  onMount(() => {
    // Web keeps native text selection; the native shells suppress it (app.css).
    if (!isNative()) document.body.classList.add('is-web');

    const teardowns = [player.init(), player.bindKeyboard(), nowPlaying.start()];
    void initNativeShell();
    void registerPWA();

    return () => teardowns.forEach((fn) => fn());
  });

  // Keep the lock screen / Bluetooth head unit in step with the feed. Runs on
  // every poll; the engine dedupes when the track hasn't actually changed.
  $effect(() => {
    player.updateMetadata(nowPlaying.data.nowPlaying);
  });
</script>

<div class="bg-ink flex min-h-dvh flex-col">
  <main class="flex-1 pb-20">
    {@render children()}
  </main>

  <nav class="border-bone/12 bg-tar/95 safe-bottom fixed right-0 bottom-0 left-0 z-40 border-t backdrop-blur" aria-label="Main">
    <div class="mx-auto flex max-w-lg">
      {#each navItems as item (item.href)}
        {@const Icon = item.icon}
        {@const active = isActive(item)}
        <a
          href={item.href}
          aria-current={active ? 'page' : undefined}
          class={['flex flex-1 flex-col items-center justify-center gap-1 py-3 transition-colors', active ? 'text-signal' : 'text-bone/45 hover:text-bone/75']}
        >
          <Icon size={20} strokeWidth={active ? 2.4 : 1.8} />
          <span class="elite text-[10px] tracking-[0.2em] uppercase">{item.label}</span>
        </a>
      {/each}
    </div>
  </nav>
</div>
