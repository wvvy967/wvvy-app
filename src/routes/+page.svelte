<script lang="ts">
  import { onMount } from 'svelte';
  import { Volume2, TriangleAlert, Radio, ListMusic, Disc3 } from '@lucide/svelte';
  import { VolumeSlider, RoutePicker } from 'capacitor-plugin-system-volume';
  import { player } from '$lib/stores/player.svelte';
  import { nowPlaying } from '$lib/stores/nowplaying.svelte';
  import { hasTrack, fmtLocalClock } from '$lib/azuracast';
  import { STATION } from '$lib/station';
  import { isNative, platform } from '$lib/native';
  import AlbumArt from '$lib/components/AlbumArt.svelte';
  import PlayButton from '$lib/components/PlayButton.svelte';

  // On iOS the volume control is a native MPVolumeView (system volume, synced to
  // the hardware buttons) overlaid on this placeholder — see the native engine.
  // Everywhere else the web <input> below controls the <audio> element directly.
  // Store-screenshot mode (set by tools/screenshots/harness.js before boot): the
  // native MPVolumeView / AVRoutePickerView render empty in the simulator, so a
  // capture swaps in the styled web slider instead of an empty native one.
  const shotMode =
    typeof localStorage !== 'undefined' &&
    (() => {
      try {
        return localStorage.getItem('wvvy:shot') === '1';
      } catch {
        return false;
      }
    })();

  const useNativeVolume = isNative() && platform() === 'ios' && !shotMode;
  let volumeEl = $state<HTMLElement>();
  let airplayEl = $state<HTMLElement>();

  // Two views over one screen, like Apple Music: the big-art player, and a queue
  // view that shrinks the art to a thumbnail and lists recently played. The
  // transport (play + volume) stays pinned at the bottom in BOTH, so the native
  // volume overlay never has to move, and the list scrolls inside its own region
  // rather than scrolling the page (which would drag that overlay around).
  let mode = $state<'player' | 'queue'>('player');

  onMount(() => {
    if (!useNativeVolume) return;
    let destroyed = false;
    const live: Array<{ destroy: () => Promise<void> }> = [];
    // Never break the page if the native side is absent; tear down whatever got
    // created if the component unmounts before the async create resolves.
    const keep = (p: Promise<{ destroy: () => Promise<void> }>) =>
      void p
        .then((o) => {
          if (destroyed) void o.destroy();
          else live.push(o);
        })
        .catch(() => {});

    if (volumeEl) {
      keep(
        VolumeSlider.create({
          id: 'wvvy-volume',
          element: volumeEl,
          style: {
            minimumTrackColor: '#c4ff3d', // signal
            maximumTrackColor: '#5a5852', // smoke
            thumbColor: '#ece5d8', // bone
            thumbRadius: 14
          }
        })
      );
    }
    if (airplayEl) {
      keep(
        RoutePicker.create({
          id: 'wvvy-airplay',
          element: airplayEl,
          style: { tintColor: '#8f8a80', activeTintColor: '#c4ff3d' }
        })
      );
    }

    return () => {
      destroyed = true;
      for (const o of live) void o.destroy();
    };
  });

  const track = $derived(nowPlaying.data.nowPlaying);
  const live = $derived(nowPlaying.data.live);
  const known = $derived(hasTrack(track));

  // The station is on the air regardless of whether we're pulling audio — the
  // bulb reflects the broadcast, not this device's playback.
  const onAir = $derived(live.isLive || known);

  // Drop the current track from history: AzuraCast includes it, and showing it
  // twice reads as a bug.
  const recent = $derived(nowPlaying.data.history.filter((h) => !(h.title === track.title && h.artist === track.artist)).slice(0, 12));
</script>

<div class="fit-main mx-auto flex w-full max-w-lg flex-col overflow-hidden px-5">
  <!-- Station header -->
  <header class="flex shrink-0 items-center justify-between pt-5 pb-4">
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

  <!-- Content region: the big-art player, or the queue. It fills the space above
       the fixed transport; in queue view the list scrolls inside here, never the
       page. -->
  <div class="flex min-h-0 flex-1 flex-col">
    {#if mode === 'player'}
      <!-- Album art fills the available height, staying square. The absolute
           inset gives it a definite box to size against so it adapts to any
           phone without a hand-tuned height. -->
      <div class="relative min-h-0 flex-1">
        <div class="absolute inset-0 flex items-center justify-center">
          <div class="aspect-square h-full max-w-full">
            <AlbumArt src={track.art} alt={known ? `${track.artist} — ${track.title}` : ''} playing={player.isPlaying} />
          </div>
        </div>
      </div>

      <!-- Now playing -->
      <section class="shrink-0 pt-4 text-center" aria-live="polite">
        <div class="elite text-signal/80 text-[10px] tracking-[0.3em] uppercase">
          {live.isLive && live.streamer ? `Live · ${live.streamer}` : 'Now Playing'}
        </div>

        {#if known}
          <h2 class="text-bone mt-2 text-xl leading-snug font-medium text-balance">
            {track.title || 'Untitled'}
          </h2>
          {#if track.artist}
            <p class="elite text-bone/60 mt-1 text-sm">{track.artist}</p>
          {/if}
        {:else}
          <h2 class="text-bone/50 mt-2 text-xl font-medium">
            {nowPlaying.error ? 'Track info unavailable' : 'Tune in'}
          </h2>
          <p class="elite text-bone/40 mt-1 text-sm">{STATION.tagline}</p>
        {/if}
      </section>
    {:else}
      <!-- Queue: compact now-playing header + the recently-played list. -->
      <div class="flex shrink-0 items-center gap-3 pb-3">
        <div class="brutal-frame bg-soot relative aspect-square w-16 shrink-0 overflow-hidden">
          <div class="text-bone/15 absolute inset-0 flex items-center justify-center"><Radio size={24} strokeWidth={1} /></div>
          {#if track.art}
            <img src={track.art} alt="" class="relative h-full w-full object-cover" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')} />
          {/if}
        </div>
        <div class="min-w-0">
          <div class="elite text-signal/80 text-[9px] tracking-[0.3em] uppercase">Now Playing</div>
          <h2 class="text-bone mt-0.5 truncate text-base leading-tight">{known ? track.title || 'Untitled' : 'Tune in'}</h2>
          {#if known && track.artist}
            <p class="elite text-bone/55 truncate text-xs">{track.artist}</p>
          {/if}
        </div>
      </div>

      <h3 class="elite text-bone/40 shrink-0 pb-2 text-[10px] tracking-[0.3em] uppercase">Recently Played</h3>
      <div class="min-h-0 flex-1 overflow-y-auto">
        {#if recent.length > 0}
          <ul class="divide-bone/8 divide-y">
            {#each recent as item, i (`${item.playedAt ?? i}-${item.title}`)}
              <li class="flex items-center gap-3 py-2.5">
                <div class="bg-soot relative aspect-square w-10 shrink-0 overflow-hidden">
                  <div class="text-bone/15 absolute inset-0 flex items-center justify-center"><Radio size={16} strokeWidth={1} /></div>
                  {#if item.art}
                    <img src={item.art} alt="" class="relative h-full w-full object-cover" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')} />
                  {/if}
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-bone/80 truncate text-sm">{item.title || 'Untitled'}</p>
                  {#if item.artist}
                    <p class="elite text-bone/40 truncate text-xs">{item.artist}</p>
                  {/if}
                </div>
                <span class="elite text-bone/30 shrink-0 text-[10px] tabular-nums">{fmtLocalClock(item.playedAt)}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="elite text-bone/30 py-6 text-center text-xs">Nothing played yet.</p>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Transport — pinned at the bottom, identical in both views so the native
       volume overlay never moves. -->
  <section class="shrink-0 pt-4">
    <div class="flex flex-col items-center">
      <PlayButton />

      <!-- Volume sits directly under the play button. iOS overlays a native
           MPVolumeView on this placeholder; elsewhere the web <input> drives the
           <audio> element. -->
      {#if useNativeVolume}
        <div class="mt-4 flex w-full max-w-xs items-center gap-3">
          <Volume2 size={16} class="text-bone/40 shrink-0" />
          <capacitor-volume-slider bind:this={volumeEl} class="block h-7 flex-1" aria-label="Volume"></capacitor-volume-slider>
          <capacitor-airplay-button bind:this={airplayEl} class="block h-7 w-7 shrink-0" aria-label="AirPlay"></capacitor-airplay-button>
        </div>
      {:else if player.canSetVolume || shotMode}
        <div class="mt-4 flex w-full max-w-xs items-center gap-3">
          <Volume2 size={16} class="text-bone/40 shrink-0" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={shotMode ? 0.7 : player.volume}
            oninput={(e) => player.setVolume(Number(e.currentTarget.value))}
            aria-label="Volume"
            class="accent-signal bg-soot h-1 w-full cursor-pointer appearance-none rounded-full"
          />
        </div>
      {/if}

      <!-- Status line. Fixed height so the layout doesn't jump as it changes. -->
      <div class="mt-3 flex h-5 items-center justify-center">
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
    </div>

    <!-- Queue toggle: swaps the view above between the player and recently played. -->
    <div class="mt-1 flex justify-center pb-1">
      <button
        type="button"
        onclick={() => (mode = mode === 'player' ? 'queue' : 'player')}
        aria-pressed={mode === 'queue'}
        class="elite text-bone/50 hover:text-bone flex items-center gap-2 px-3 py-2 text-[10px] tracking-[0.2em] uppercase transition-colors"
      >
        {#if mode === 'player'}
          <ListMusic size={15} /> Recently Played
        {:else}
          <Disc3 size={15} /> Now Playing
        {/if}
      </button>
    </div>
  </section>
</div>
