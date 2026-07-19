<script lang="ts">
  import { onMount } from 'svelte';
  import { CalendarX, RefreshCw } from '@lucide/svelte';
  import { DAYS, currentDay, currentHour, isOnNow, type Day } from '$lib/schedule';
  import { scheduleFeed } from '$lib/stores/schedule.svelte';

  const today = currentDay();
  let selected = $state<Day>(today);

  // Recomputed once a minute so the "ON NOW" badge doesn't go stale while the
  // screen sits open — a schedule is exactly the screen someone leaves up.
  let now = $state(currentHour());

  // The seven day tabs overflow a phone's width, and the selected day defaults
  // to today — which for late-week days sits off-screen, so the screen opens
  // looking like nothing is selected. Bring it into view on mount.
  let tablist = $state<HTMLDivElement | null>(null);

  onMount(() => {
    void scheduleFeed.load();
    // `block: 'nearest'` keeps this from scrolling the page vertically as well.
    tablist?.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    const timer = setInterval(() => (now = currentHour()), 60_000);
    return () => clearInterval(timer);
  });

  const shows = $derived(scheduleFeed.data[selected] ?? []);
  // "On now" only applies to today's column — Friday's 8 PM show isn't on air
  // just because it's 8 PM on a Tuesday.
  const showsToday = $derived(selected === today);
</script>

<div class="mx-auto w-full max-w-lg px-5 pt-6 pb-8">
  <header class="flex items-start justify-between gap-4">
    <div>
      <div class="elite text-signal mb-2 text-[10px] tracking-[0.3em] uppercase">This week</div>
      <h1 class="stencil text-bone text-4xl leading-[0.85]">
        SHOW<br /><span class="text-signal">SCHEDULE</span>
      </h1>
    </div>
    <button type="button" onclick={() => scheduleFeed.load(true)} aria-label="Reload the schedule" class="text-bone/40 hover:text-signal mt-1 shrink-0 p-2 transition-colors">
      <RefreshCw size={16} class={scheduleFeed.loading ? 'animate-spin' : ''} />
    </button>
  </header>

  <!-- Day picker. Scrolls horizontally so seven days fit any phone width. -->
  <div class="-mx-5 mt-6 overflow-x-auto px-5">
    <div bind:this={tablist} class="flex min-w-max gap-2" role="tablist" aria-label="Day of week">
      {#each DAYS as day (day)}
        {@const active = day === selected}
        <button
          type="button"
          role="tab"
          aria-selected={active}
          onclick={() => (selected = day)}
          class={[
            'elite border px-3.5 py-2 text-[11px] tracking-[0.2em] uppercase transition-colors',
            active ? 'border-signal bg-signal text-ink' : 'border-bone/20 text-bone/60 hover:border-bone/40 hover:text-bone'
          ]}
        >
          {day}
          {#if day === today}
            <span class={['ml-1', active ? 'text-ink/60' : 'text-signal']}>•</span>
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <!-- Shows -->
  <section class="mt-7">
    {#if shows.length === 0}
      <div class="border-bone/12 text-bone/40 flex flex-col items-center gap-3 border border-dashed px-6 py-12 text-center">
        <CalendarX size={28} strokeWidth={1.2} />
        <p class="elite text-sm">No scheduled shows on {selected}.</p>
        <p class="elite text-xs">Automated rotation is on the air.</p>
      </div>
    {:else}
      <ul class="flex flex-col gap-3">
        {#each shows as show (`${show.show}-${show.start}`)}
          {@const onNow = showsToday && isOnNow(show, now)}
          <li class={['brutal-frame bg-tar/60 p-4', onNow && 'border-signal/60']}>
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h2 class="stencil text-bone text-xl leading-tight">{show.show}</h2>
                {#if show.dj}
                  <p class="elite text-bone/55 mt-1.5 text-xs tracking-[0.15em] uppercase">
                    DJ {show.dj}
                  </p>
                {/if}
              </div>
              {#if onNow}
                <span class="elite bg-rust text-bone shrink-0 px-2 py-1 text-[9px] tracking-[0.2em] uppercase"> On Now </span>
              {/if}
            </div>
            <p class={['elite mt-3 text-sm tabular-nums', onNow ? 'text-signal' : 'text-bone/70']}>
              {show.display}
            </p>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- Provenance. The static fallback is a week-old snapshot, so say so rather
       than presenting it as the live schedule. -->
  {#if scheduleFeed.error}
    <p class="elite text-amber/70 mt-6 text-center text-[10px] leading-relaxed tracking-[0.15em] uppercase">Live schedule unavailable — showing last known times</p>
  {:else if scheduleFeed.source === 'sheet'}
    <p class="elite text-bone/25 mt-6 text-center text-[10px] tracking-[0.2em] uppercase">Live from the station schedule</p>
  {/if}

  <p class="elite text-bone/30 mt-4 text-center text-xs leading-relaxed">Times are Eastern. Shows change — when nothing is scheduled, automated rotation keeps 96.7 on the air.</p>
</div>
