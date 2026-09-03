<script lang="ts">
  import { onMount } from 'svelte';
  import { Volume2, TriangleAlert } from '@lucide/svelte';
  import { VolumeSlider } from 'capacitor-plugin-system-volume';
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
  const useNativeVolume = isNative() && platform() === 'ios';
  let volumeEl = $state<HTMLElement>();

  onMount(() => {
    const el = volumeEl;
    if (!useNativeVolume || !el) return;
    let destroyed = false;
    let slider: VolumeSlider | null = null;
    VolumeSlider.create({
      id: 'wvvy-volume',
      element: el,
      style: {
        minimumTrackColor: '#c4ff3d', // signal
        maximumTrackColor: '#5a5852', // smoke
        thumbColor: '#ece5d8', // bone
        thumbRadius: 14
      }
    })
      .then((s) => {
        if (destroyed) void s.destroy();
        else slider = s;
      })
      .catch(() => {}); // never break the page if the native side is absent
    return () => {
      destroyed = true;
      void slider?.destroy();
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
  const recent = $derived(nowPlaying.data.history.filter((h) => !(h.title === track.title && h.artist === track.artist)).slice(0, 6));
</script>

<div class="mx-auto w-full max-w-lg px-5">
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

  <!-- The art is square but must never push the transport — play control AND the
       volume slider below it — off-screen. Capping the side at 32dvh keeps the
       header, track info, and the whole transport in one viewport on every phone
       (there is no scroll cue, so the slider must be visible without scrolling);
       on taller screens the width becomes the limit again and the art fills the
       column. -->
  <div class="mx-auto w-full" style="max-width: min(100%, 32dvh)">
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

    <!-- Volume sits directly under the play button so it reads as part of the
         transport, not a stray control. Its position is fixed regardless of play
         state (the status line below absorbs the changes).
         iOS: a native MPVolumeView is overlaid on this placeholder, so the
         on-screen slider drives the system volume and tracks the hardware
         buttons. The box must have a fixed height for the native view to fill. -->
    {#if useNativeVolume}
      <div class="mt-4 flex w-full max-w-xs items-center gap-3">
        <Volume2 size={16} class="text-bone/40 shrink-0" />
        <capacitor-volume-slider bind:this={volumeEl} class="block h-7 w-full" aria-label="Volume"></capacitor-volume-slider>
      </div>
    {:else if player.canSetVolume}
      <div class="mt-4 flex w-full max-w-xs items-center gap-3">
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

    <!-- Status line, below the transport. Fixed height so the layout doesn't jump
         as it changes between idle / connecting / streaming / error. -->
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
