<script lang="ts">
  import { Radio } from '@lucide/svelte';

  let { src, alt = '', playing = false }: { src?: string; alt?: string; playing?: boolean } = $props();

  // Art comes from arbitrary track metadata, so a broken URL is routine rather
  // than exceptional — fall back to the station mark instead of a broken image.
  let failed = $state(false);
  // Reset on every new URL, or one bad cover would poison the slot for the rest
  // of the session.
  $effect(() => {
    void src;
    failed = false;
  });

  const showArt = $derived(!!src && !failed);
</script>

<div class="brutal-frame bg-soot relative aspect-square w-full overflow-hidden">
  {#if showArt}
    <img {src} {alt} class="h-full w-full object-cover" onerror={() => (failed = true)} />
  {:else}
    <div class="text-bone/15 flex h-full w-full items-center justify-center">
      <Radio size={72} strokeWidth={1} />
    </div>
  {/if}

  <!-- Equaliser overlay: the at-a-glance "audio is actually flowing" signal. -->
  {#if playing}
    <div class="absolute bottom-0 left-0 flex items-end gap-[3px] bg-gradient-to-t from-black/70 to-transparent p-3 pt-8" aria-hidden="true">
      {#each [0, 1, 2, 3, 4] as i (i)}
        <span class="eq-bar bg-signal block h-5 w-[3px]" style="animation-delay: {i * 0.13}s"></span>
      {/each}
    </div>
  {/if}
</div>
