<script lang="ts">
  import { ExternalLink, Copy, Check, Mic, Radio, Globe } from '@lucide/svelte';
  import { STATION, LISTEN } from '$lib/station';
  import { nowPlaying } from '$lib/stores/nowplaying.svelte';
  import { openExternal } from '$lib/native';

  let copiedUrl = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  async function copyStreamUrl() {
    try {
      await navigator.clipboard.writeText(LISTEN.direct);
      copiedUrl = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copiedUrl = false), 2000);
    } catch {
      // Clipboard blocked — the URL is shown in full above the button.
    }
  }

  // Only rendered once the feed has actually reported a mount.
  const bitrate = $derived(nowPlaying.data.bitrate);
  const format = $derived(nowPlaying.data.format);
</script>

<div class="safe-top mx-auto w-full max-w-lg px-5 pt-6 pb-8">
  <header>
    <div class="elite text-signal mb-2 text-[10px] tracking-[0.3em] uppercase">Since 2007</div>
    <h1 class="stencil text-bone text-4xl leading-[0.85]">
      WVVY<br /><span class="text-signal">96.7 LPFM</span>
    </h1>
    <p class="elite text-bone/65 mt-5 text-sm leading-relaxed">
      Low-power community radio broadcasting from {STATION.location}. Free-form and no-format — every show is programmed by a volunteer from the island, playing whatever they brought with them. No
      ads, no underwriters, no corporate playlist.
    </p>
  </header>

  <!-- Get involved -->
  <section class="mt-10">
    <h2 class="elite text-bone/40 mb-4 text-[10px] tracking-[0.3em] uppercase">Get Involved</h2>

    <div class="brutal-frame bg-tar/80 p-5">
      <Mic size={20} class="text-signal" />
      <h3 class="stencil text-bone mt-3 text-xl">HOST A SHOW</h3>
      <p class="elite text-bone/65 mt-2 text-sm leading-relaxed">
        No experience needed — most of our DJs had none. If you've got a couple of hours a week and something you want to play, the station will teach you the rest.
      </p>
    </div>

    <button
      type="button"
      onclick={() => openExternal(`mailto:${STATION.email}`)}
      class="border-signal bg-signal/10 text-signal hover:bg-signal hover:text-ink mt-5 flex w-full items-center justify-between gap-4 border px-5 py-4 transition-colors"
    >
      <span class="stencil text-lg tracking-wider">EMAIL THE STATION</span>
      <ExternalLink size={16} />
    </button>
    <p class="elite text-bone/40 mt-2 text-center text-xs">{STATION.email}</p>
  </section>

  <!-- Listen elsewhere -->
  <section class="mt-10">
    <h2 class="elite text-bone/40 mb-4 text-[10px] tracking-[0.3em] uppercase">Listen Elsewhere</h2>
    <p class="elite text-bone/60 text-sm leading-relaxed">
      Paste the stream URL into any player — Sonos, VLC, a car stereo, a smart speaker. The playlist files suit hardware that wants .pls or .m3u.
    </p>

    <div class="border-bone/15 bg-ink mt-4 border p-3">
      <code class="elite text-bone/75 selectable block text-xs break-all">{LISTEN.direct}</code>
    </div>

    <button
      type="button"
      onclick={copyStreamUrl}
      class="border-bone/40 text-bone hover:border-signal hover:text-signal elite mt-3 flex w-full items-center justify-between gap-4 border px-5 py-3.5 text-[11px] tracking-[0.3em] uppercase transition-colors"
    >
      <span>{copiedUrl ? 'Copied' : 'Copy stream URL'}</span>
      {#if copiedUrl}
        <Check size={16} class="text-signal" />
      {:else}
        <Copy size={16} />
      {/if}
    </button>

    <div class="mt-3 grid grid-cols-2 gap-3">
      <button
        type="button"
        onclick={() => openExternal(LISTEN.pls)}
        class="border-bone/25 text-bone/80 hover:border-signal hover:text-signal elite border px-4 py-3 text-[11px] tracking-[0.25em] uppercase transition-colors"
      >
        .PLS
      </button>
      <button
        type="button"
        onclick={() => openExternal(LISTEN.m3u)}
        class="border-bone/25 text-bone/80 hover:border-signal hover:text-signal elite border px-4 py-3 text-[11px] tracking-[0.25em] uppercase transition-colors"
      >
        .M3U
      </button>
    </div>
  </section>

  <!-- Signal details -->
  <section class="border-bone/10 mt-10 border-t pt-6">
    <h2 class="elite text-bone/40 mb-4 text-[10px] tracking-[0.3em] uppercase">Signal</h2>
    <dl class="elite text-sm">
      <div class="border-bone/8 flex justify-between border-b py-2.5">
        <dt class="text-bone/50">Frequency</dt>
        <dd class="text-bone/85">{STATION.frequency} FM</dd>
      </div>
      <div class="border-bone/8 flex justify-between border-b py-2.5">
        <dt class="text-bone/50">Transmitter</dt>
        <dd class="text-bone/85">{STATION.location}</dd>
      </div>
      <div class="border-bone/8 flex justify-between border-b py-2.5">
        <dt class="text-bone/50">Licensee</dt>
        <dd class="text-bone/85">{STATION.legalName}</dd>
      </div>
      {#if bitrate || format}
        <div class="border-bone/8 flex justify-between border-b py-2.5">
          <dt class="text-bone/50">Stream</dt>
          <dd class="text-bone/85 uppercase">
            {[format, bitrate ? `${bitrate} kbps` : null].filter(Boolean).join(' · ')}
          </dd>
        </div>
      {/if}
    </dl>
  </section>

  <!-- Website -->
  <section class="mt-8">
    <button
      type="button"
      onclick={() => openExternal(STATION.website)}
      class="border-bone/40 text-bone hover:border-signal hover:text-signal flex w-full items-center justify-between gap-4 border px-5 py-4 transition-colors"
    >
      <span class="elite text-[11px] tracking-[0.3em] uppercase">Visit wvvy.org</span>
      <Globe size={16} />
    </button>
  </section>

  <p class="elite text-bone/25 mt-10 flex items-center justify-center gap-2 text-center text-[10px] tracking-[0.25em] uppercase">
    <Radio size={12} />
    {STATION.legalName} · {STATION.city}
  </p>
</div>
