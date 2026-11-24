<script lang="ts">
  // Touch key bar: Esc/Tab, arrows and the shell chords a soft keyboard lacks.
  import { CHORD_KEYS, NAV_KEYS, PRE_KEYS } from "./term-keybar";

  let { disabled = false, onpress }: { disabled?: boolean; onpress: (seq: string) => void } = $props();
</script>

<div class="keybar" role="toolbar" aria-label="Terminal keys">
  {#each [...PRE_KEYS, ...NAV_KEYS, ...CHORD_KEYS] as key (key.label)}
    <button type="button" class="key" aria-label={key.aria} title={key.aria} {disabled} onclick={() => onpress(key.seq)}>
      {key.label}
    </button>
  {/each}
</div>

<style>
  .keybar {
    display: flex; align-items: center; gap: 0.375rem; overflow-x: auto;
    padding: 0.25rem 0; scrollbar-width: none; min-width: 0;
  }
  .keybar::-webkit-scrollbar { display: none; }
  .key {
    flex: 0 0 auto; min-width: 2.75rem; min-height: 2.75rem; padding: 0 0.5rem;
    border: 1px solid var(--border); border-radius: 0.375rem; background: var(--panel-solid);
    color: var(--text); font-family: var(--font-mono); font-size: 0.75rem; font-weight: 600;
    cursor: pointer; user-select: none;
  }
  .key:hover:not(:disabled) { background: var(--surface); border-color: var(--accent); }
  .key:disabled { opacity: 0.5; cursor: not-allowed; }
  @media (min-width: 900px) and (pointer: fine) {
    .keybar { display: none; }
  }
</style>
