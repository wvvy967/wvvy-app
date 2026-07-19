<script lang="ts">
  import { Volume2, TriangleAlert } from '@lucide/svelte';
  import { player } from '$lib/stores/player.svelte';
  import { nowPlaying } from '$lib/stores/nowplaying.svelte';
  import { hasTrack, fmtLocalClock } from '$lib/azuracast';
  import { STATION } from '$lib/station';
  import AlbumArt from '$lib/components/AlbumArt.svelte';
  import PlayButton from '$lib/components/PlayButton.svelte';

  const track = $derived(nowPlaying.data.nowPlaying);
  const live = $derived(nowPlaying.data.live);
  const known = $derived(hasTrack(track));

  // The station is on the air regardless of whether we're pulling audio — the
  // bulb reflects the broadcast, not this device's playback.
  const onAir = $derived(live.isLive || known);

  // Drop the current track from history: AzuraCast includes it, and showing it
  // twice reads as a bug.
  const recent = $derived(nowPlaying.data.history.filter((h) => !(h.title === track.title && h.artist === track.artist)).slice(0, 6));
</script>

<div class="safe-top mx-auto w-full max-w-lg px-5">
  <!-- Station header -->
  <header class="flex items-center justify-between pt-5 pb-6">
    <div>
      <h1 class="stencil text-bone text-3xl">
        WVVY <span class="text-signal">{STATION.frequency}</span>
      </h1>
      <p class="elite text-bone/45 mt-1 text-[10px] tracking-[0.25em] uppercase">
        {STATION.location}
      </p>
    </div>
    <div class="flex items-center gap-2">
      <span class={['block h-2.5 w-2.5 rounded-full', onAir ? 'on-air' : 'bg-smoke']} aria-hidden="true"></span>
      <span class="elite text-bone/70 text-[10px] tracking-[0.25em] uppercase">
        {onAir ? 'On Air' : 'Off Air'}
      </span>
    </div>
  </header>

  <!-- The art is square but must never push the play control below the fold on a
       short screen (iPhone SE and friends). Capping the side at 40dvh keeps the
       header, track info, and transport in one viewport on every phone; on taller
       screens the width becomes the limit again and the art fills the column. -->
  <div class="mx-auto w-full" style="max-width: min(100%, 40dvh)">
    <AlbumArt src={track.art} alt={known ? `${track.artist} — ${track.title}` : ''} playing={player.isPlaying} />
  </div>

  <!-- Now playing -->
  <section class="mt-7 text-center" aria-live="polite">
    <div class="elite text-signal/80 text-[10px] tracking-[0.3em] uppercase">
      {live.isLive && live.streamer ? `Live · ${live.streamer}` : 'Now Playing'}
    </div>

    {#if known}
      <h2 class="text-bone mt-3 text-xl leading-snug font-medium text-balance">
        {track.title || 'Untitled'}
      </h2>
      {#if track.artist}
        <p class="elite text-bone/60 mt-1.5 text-sm">{track.artist}</p>
      {/if}
    {:else}
      <h2 class="text-bone/50 mt-3 text-xl font-medium">
        {nowPlaying.error ? 'Track info unavailable' : 'Tune in'}
      </h2>
      <p class="elite text-bone/40 mt-1.5 text-sm">{STATION.tagline}</p>
    {/if}
  </section>

  <!-- Transport -->
  <section class="mt-8 flex flex-col items-center">
    <PlayButton />

    <!-- Status line. Fixed height so the layout doesn't jump as it changes. -->
    <div class="mt-4 flex h-5 items-center justify-center">
      {#if player.error}
        <p class="elite text-rust flex items-center gap-1.5 text-xs" role="alert">
          <TriangleAlert size={13} />
          {player.error}
        </p>
      {:else if player.isBusy}
        <p class="elite text-bone/50 text-[10px] tracking-[0.3em] uppercase">
          {player.state.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
        </p>
      {:else if player.isPlaying}
        <p class="elite text-signal/70 text-[10px] tracking-[0.3em] uppercase">Streaming Live</p>
      {/if}
    </div>

    <!-- iOS reserves media volume for the hardware buttons, so the slider is
         hidden there rather than shown doing nothing. -->
    {#if player.canSetVolume}
      <div class="mt-5 flex w-full max-w-xs items-center gap-3">
        <Volume2 size={16} class="text-bone/40 shrink-0" />
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={player.volume}
          oninput={(e) => player.setVolume(Number(e.currentTarget.value))}
          aria-label="Volume"
          class="accent-signal bg-soot h-1 w-full cursor-pointer appearance-none rounded-full"
        />
      </div>
    {/if}
  </section>

  <!-- Recently played -->
  {#if recent.length > 0}
    <section class="mt-10 pb-6">
      <h3 class="elite text-bone/40 mb-3 text-[10px] tracking-[0.3em] uppercase">Recently Played</h3>
      <ul class="divide-bone/8 divide-y">
        {#each recent as item, i (`${item.playedAt ?? i}-${item.title}`)}
          <li class="flex items-baseline justify-between gap-3 py-2.5">
            <div class="min-w-0">
              <p class="text-bone/80 truncate text-sm">{item.title || 'Untitled'}</p>
              {#if item.artist}
                <p class="elite text-bone/40 truncate text-xs">{item.artist}</p>
              {/if}
            </div>
            <span class="elite text-bone/30 shrink-0 text-[10px] tabular-nums">
              {fmtLocalClock(item.playedAt)}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
