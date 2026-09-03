<script lang="ts">
  import { onMount } from 'svelte';
  import { RefreshCw } from '@lucide/svelte';
  import { DAY_FULL, currentDay, currentHour, isOnNow, weekFrom } from '$lib/schedule';
  import { scheduleFeed } from '$lib/stores/schedule.svelte';

  const today = currentDay();
  // The whole week, ordered so today leads — no day picker to scroll through, and
  // what's on now (and coming up) is at the top without hunting for it.
  const week = weekFrom(today);

  // Recomputed once a minute so the "ON NOW" badge doesn't go stale while the
  // screen sits open — a schedule is exactly the screen someone leaves up.
  let now = $state(currentHour());

  onMount(() => {
    void scheduleFeed.load();
    const timer = setInterval(() => (now = currentHour()), 60_000);
    return () => clearInterval(timer);
  });
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

  <!-- The full week, today first. Each day is its own section; days with no live
       show still appear so the week reads as complete. -->
  <div class="mt-7 flex flex-col gap-7">
    {#each week as day (day)}
      {@const shows = scheduleFeed.data[day] ?? []}
      {@const isToday = day === today}
      <section aria-label={DAY_FULL[day]}>
        <div class="border-bone/10 mb-3 flex items-baseline justify-between border-b pb-2">
          <h2 class={['stencil text-2xl leading-none', isToday ? 'text-signal' : 'text-bone/80']}>
            {DAY_FULL[day]}
          </h2>
          {#if isToday}
            <span class="elite text-signal/80 text-[10px] tracking-[0.25em] uppercase">Today</span>
          {/if}
        </div>

        {#if shows.length === 0}
          <p class="elite text-bone/30 text-xs tracking-[0.1em]">Automated rotation — no live show</p>
        {:else}
          <ul class="flex flex-col gap-2.5">
            {#each shows as show (`${show.show}-${show.start}`)}
              {@const onNow = isToday && isOnNow(show, now)}
              <li class={['brutal-frame bg-tar/60 p-4', onNow && 'border-signal/60']}>
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <h3 class="stencil text-bone text-lg leading-tight">{show.show}</h3>
                    {#if show.dj}
                      <p class="elite text-bone/55 mt-1.5 text-xs tracking-[0.15em] uppercase">DJ {show.dj}</p>
                    {/if}
                  </div>
                  {#if onNow}
                    <span class="elite bg-rust text-bone shrink-0 px-2 py-1 text-[9px] tracking-[0.2em] uppercase">On Now</span>
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
    {/each}
  </div>

  <!-- Provenance. The static fallback is a week-old snapshot, so say so rather
       than presenting it as the live schedule. -->
  {#if scheduleFeed.error}
    <p class="elite text-amber/70 mt-8 text-center text-[10px] leading-relaxed tracking-[0.15em] uppercase">Live schedule unavailable — showing last known times</p>
  {:else if scheduleFeed.source === 'sheet'}
    <p class="elite text-bone/25 mt-8 text-center text-[10px] tracking-[0.2em] uppercase">Live from the station schedule</p>
  {/if}

  <p class="elite text-bone/30 mt-4 text-center text-xs leading-relaxed">Times are Eastern. Shows change — when nothing is scheduled, automated rotation keeps 96.7 on the air.</p>
</div>
