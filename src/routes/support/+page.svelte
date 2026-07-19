<script lang="ts">
  import { Copy, Check, ExternalLink } from '@lucide/svelte';
  import { STATION, PAYPAL_URL, VENMO_URL, VENMO_HANDLE } from '$lib/station';
  import { openExternal } from '$lib/native';

  const mailingText = `${STATION.legalName}\n${STATION.poBox}\n${STATION.city}`;

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  async function copyMailing() {
    try {
      await navigator.clipboard.writeText(mailingText);
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 2000);
    } catch {
      // Clipboard blocked — the address is printed directly above the button.
    }
  }
</script>

<div class="safe-top mx-auto w-full max-w-lg px-5 pt-6 pb-8">
  <header>
    <div class="elite text-signal mb-2 text-[10px] tracking-[0.3em] uppercase">Keep us on air</div>
    <h1 class="stencil text-bone text-4xl leading-[0.85]">
      SUPPORT<br /><span class="text-signal">COMMUNITY RADIO</span>
    </h1>
    <p class="elite text-bone/65 mt-5 text-sm leading-relaxed">
      WVVY runs on the goodwill of the community. We've kept 96.7 lit since 2007 on word of mouth, a wing, and a prayer. Every dollar buys a few more watts of free-form, no-format radio. No ads. No
      underwriters. Just the people in the room and whatever they brought.
    </p>
  </header>

  <!-- Venmo — fastest path, so it leads. -->
  <section class="brutal-frame bg-tar/80 mt-10 p-5">
    <div class="elite text-signal text-[10px] tracking-[0.3em] uppercase">Fastest · No fees</div>
    <h2 class="stencil text-bone mt-2 text-2xl">VENMO</h2>
    <div class="border-bone/15 bg-ink elite text-bone mt-3 inline-block border px-3 py-1.5 text-sm tracking-[0.15em]">
      @{VENMO_HANDLE}
    </div>
    <button
      type="button"
      onclick={() => openExternal(VENMO_URL)}
      class="border-signal bg-signal/10 text-signal hover:bg-signal hover:text-ink mt-5 flex w-full items-center justify-between gap-4 border px-5 py-4 transition-colors"
    >
      <span class="stencil text-lg tracking-wider">OPEN VENMO</span>
      <ExternalLink size={16} />
    </button>
  </section>

  <!-- PayPal -->
  <section class="brutal-frame bg-tar/80 mt-8 p-5">
    <div class="elite text-bone/50 text-[10px] tracking-[0.3em] uppercase">Card · Bank · PayPal</div>
    <h2 class="stencil text-bone mt-2 text-2xl">PAYPAL</h2>
    <p class="elite text-bone/65 mt-3 text-sm leading-relaxed">Give with a card or your PayPal balance — one-time or a monthly gift.</p>
    <button
      type="button"
      onclick={() => openExternal(PAYPAL_URL)}
      class="border-bone/40 text-bone hover:border-signal hover:text-signal mt-5 flex w-full items-center justify-between gap-4 border px-5 py-4 transition-colors"
    >
      <span class="stencil text-lg tracking-wider">DONATE / PAYPAL</span>
      <ExternalLink size={16} />
    </button>
  </section>

  <!-- Check by mail -->
  <section class="brutal-frame bg-tar/80 mt-8 p-5">
    <div class="elite text-bone/50 text-[10px] tracking-[0.3em] uppercase">Old school · Zero fees</div>
    <h2 class="stencil text-bone mt-2 text-2xl">BY CHECK</h2>
    <p class="elite text-bone/65 mt-3 text-sm leading-relaxed">
      A mailed check means every cent reaches the station. Make it out to {STATION.legalName}.
    </p>
    <address class="elite text-bone/85 selectable mt-4 text-sm leading-relaxed not-italic">
      {STATION.legalName}<br />
      {STATION.poBox}<br />
      {STATION.city}
    </address>
    <button
      type="button"
      onclick={copyMailing}
      class="border-bone/40 text-bone hover:border-signal hover:text-signal elite mt-5 flex w-full items-center justify-between gap-4 border px-5 py-4 text-[11px] tracking-[0.3em] uppercase transition-colors"
    >
      <span>{copied ? 'Copied' : 'Copy address'}</span>
      {#if copied}
        <Check size={16} class="text-signal" />
      {:else}
        <Copy size={16} />
      {/if}
    </button>
  </section>

  <!-- Tax status -->
  <section class="border-bone/10 mt-10 border-t pt-6">
    <div class="elite text-signal mb-2 text-[10px] tracking-[0.3em] uppercase">Section 501(c)(3)</div>
    <h2 class="stencil text-bone text-2xl">TAX DEDUCTIBLE</h2>
    <p class="elite text-bone/65 mt-3 text-sm leading-relaxed">
      {STATION.legalName} is a registered 501(c)(3) nonprofit, so your gift is tax-deductible to the extent the law allows. Need a receipt for your records? Email
      <button type="button" onclick={() => openExternal(`mailto:${STATION.email}`)} class="text-signal underline underline-offset-2">
        {STATION.email}
      </button>
      and we'll send one over.
    </p>
  </section>
</div>
