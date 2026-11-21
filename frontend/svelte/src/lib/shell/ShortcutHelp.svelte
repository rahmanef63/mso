<script lang="ts">
  import { tick } from "svelte";

  let {
    open,
    shortcuts,
    onClose,
  }: {
    open: boolean;
    shortcuts: ReadonlyArray<{ keys: string; description: string }>;
    onClose: () => void;
  } = $props();

  let closeBtn = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    if (!open) return;
    void tick().then(() => {
      closeBtn?.focus();
    });
  });

  function handleWindowKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open}
  <div class="shortcut-layer">
    <button
      type="button"
      class="shortcut-backdrop"
      aria-label="Close keyboard shortcuts"
      tabindex="-1"
      onclick={onClose}
    ></button>

    <div
      class="shortcut-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-help-title"
    >
      <header class="shortcut-header">
        <h2 id="shortcut-help-title">Keyboard shortcuts</h2>
        <button type="button" bind:this={closeBtn} class="shortcut-close" onclick={onClose}>
          Close
        </button>
      </header>

      <div class="shortcut-body">
        {#if shortcuts.length === 0}
          <p class="shortcut-empty">No keyboard shortcuts are registered for this view.</p>
        {:else}
          <ul class="shortcut-list">
            {#each shortcuts as entry (entry.keys + entry.description)}
              <li class="shortcut-row">
                <span class="shortcut-desc">{entry.description}</span>
                <kbd class="shortcut-keys">{entry.keys}</kbd>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .shortcut-layer {
    position: fixed; inset: 0; z-index: 60;
    display: grid; place-items: center; padding: 1rem;
  }
  .shortcut-backdrop {
    position: fixed; inset: 0; min-height: 0; padding: 0; border: 0; border-radius: 0;
    background: rgba(0, 0, 0, 0.45); cursor: default;
  }
  .shortcut-dialog {
    position: relative; z-index: 1; width: min(32rem, 100%); max-height: 80vh;
    display: grid; grid-template-rows: auto minmax(0, 1fr);
    background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: .75rem; overflow: hidden;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
  }
  .shortcut-header {
    display: flex; align-items: center; justify-content: space-between; gap: .75rem;
    padding: .75rem 1rem; background: var(--surface); border-bottom: 1px solid var(--border);
  }
  .shortcut-header h2 { margin: 0; font-size: 1.0625rem; }
  .shortcut-close { min-height: var(--ui-control-height); padding: .5rem .875rem; }
  .shortcut-body { padding: 1rem; overflow-y: auto; }
  .shortcut-empty { margin: 0; color: var(--muted); }
  .shortcut-list { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; }
  .shortcut-row {
    display: flex; align-items: center; justify-content: space-between; gap: 1rem;
    padding: .625rem .75rem; background: var(--surface);
    border: 1px solid var(--border); border-radius: .5rem;
  }
  .shortcut-desc { color: var(--text); overflow-wrap: anywhere; }
  .shortcut-keys {
    flex-shrink: 0; padding: .2rem .5rem; font-size: .8125rem; font-family: inherit;
    color: var(--text); background: var(--panel);
    border: 1px solid var(--border); border-radius: .25rem;
  }
</style>
