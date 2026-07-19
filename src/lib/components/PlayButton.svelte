<script lang="ts">
  import { Play, Pause, Loader } from '@lucide/svelte';
  import { player } from '$lib/stores/player.svelte';

  const label = $derived(player.showsPause ? 'Stop the live stream' : 'Play the live stream');
</script>

<button
  type="button"
  onclick={() => void player.toggle()}
  aria-label={label}
  aria-pressed={player.showsPause}
  class="border-signal bg-signal/10 text-signal hover:bg-signal hover:text-ink focus-visible:outline-signal flex h-20 w-20 items-center justify-center rounded-full border-2 transition-all focus-visible:outline-2 focus-visible:outline-offset-4 active:scale-95"
>
  {#if player.isBusy}
    <Loader size={30} strokeWidth={2} class="animate-spin" />
  {:else if player.showsPause}
    <Pause size={30} strokeWidth={2.5} fill="currentColor" />
  {:else}
    <!-- Nudged right so the triangle looks centred inside the circle. -->
    <Play size={30} strokeWidth={2.5} fill="currentColor" class="ml-1" />
  {/if}
</button>
