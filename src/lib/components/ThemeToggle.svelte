<script lang="ts">
  import { Monitor, Sun, Moon } from '@lucide/svelte';
  import { theme, type ThemePref } from '#lib/theme.svelte.js';

  const options: { value: ThemePref; label: string; icon: typeof Monitor }[] = [
    { value: 'system', label: 'System', icon: Monitor },
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon }
  ];
</script>

<fieldset class="border-bone/25 grid grid-cols-3 border" aria-label="Appearance">
  {#each options as opt (opt.value)}
    {@const Icon = opt.icon}
    {@const active = theme.pref === opt.value}
    <button
      type="button"
      onclick={() => theme.set(opt.value)}
      aria-pressed={active}
      class={[
        'elite flex flex-col items-center justify-center gap-1.5 py-3 text-[10px] tracking-[0.2em] uppercase transition-colors',
        active ? 'bg-signal text-contrast' : 'text-bone/55 hover:text-signal'
      ]}
    >
      <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
      {opt.label}
    </button>
  {/each}
</fieldset>
