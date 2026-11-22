<script lang="ts">
  import { tick } from "svelte";
  import type { WindowState } from "./window-store.ts";

  let {
    open,
    windows,
    onForceClose,
    onCloseAll,
    onClose,
  }: {
    open: boolean;
    windows: readonly WindowState[];
    onForceClose: (id: string) => void;
    onCloseAll: () => void;
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

  function statusLabel(win: WindowState): string {
    if (win.minimized && win.maximized) return "Minimized, Maximized";
    if (win.minimized) return "Minimized";
    if (win.maximized) return "Maximized";
    return "Open";
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open}
  <div class="fq-layer">
    <button
      type="button"
      class="fq-backdrop"
      aria-label="Close force quit dialog"
      tabindex="-1"
      onclick={onClose}
    ></button>

    <div
      class="fq-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="force-quit-title"
    >
      <header class="fq-header">
        <div>
          <h2 id="force-quit-title">Force quit windows</h2>
          <p class="fq-sub">Close unresponsive windows immediately without unsaved prompts.</p>
        </div>
        <button type="button" bind:this={closeBtn} class="fq-close" onclick={onClose}>
          Close
        </button>
      </header>

      <div class="fq-body">
        {#if windows.length === 0}
          <p class="fq-empty" role="status">No open windows right now.</p>
        {:else}
          <ul class="fq-list" aria-label="Open windows">
            {#each windows as win (win.id)}
              <li class="fq-row">
                <div class="fq-info">
                  <span class="fq-title">{win.title}</span>
                  <span class="fq-meta">{win.app} | {statusLabel(win)}</span>
                </div>
                <button
                  type="button"
                  class="danger"
                  aria-label={`Force close ${win.title}`}
                  onclick={() => onForceClose(win.id)}
                >
                  Force close
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <footer class="fq-footer">
        <span class="fq-count">{windows.length} open</span>
        <div class="actions">
          <button
            type="button"
            class="danger"
            disabled={windows.length === 0}
            onclick={onCloseAll}
          >
            Close all
          </button>
          <button type="button" onclick={onClose}>Done</button>
        </div>
      </footer>
    </div>
  </div>
{/if}

<style>
  .fq-layer {
    position: fixed; inset: 0; z-index: 65;
    display: grid; place-items: center; padding: 1rem;
  }
  .fq-backdrop {
    position: fixed; inset: 0; min-height: 0; padding: 0; border: 0; border-radius: 0;
    background: rgba(0, 0, 0, 0.45); cursor: default;
  }
  .fq-dialog {
    position: relative; z-index: 1; width: min(34rem, 100%); max-height: 82vh;
    display: grid; grid-template-rows: auto minmax(0, 1fr) auto;
    background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: 0.75rem; overflow: hidden;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
  }
  .fq-header {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem;
    padding: 0.75rem 1rem; background: var(--surface); border-bottom: 1px solid var(--border);
  }
  .fq-header h2 { margin: 0; font-size: 1.0625rem; }
  .fq-sub { margin: 0.2rem 0 0; font-size: 0.8125rem; color: var(--muted); }
  .fq-close { min-height: var(--ui-control-height); padding: 0.5rem 0.875rem; flex-shrink: 0; }
  .fq-body { padding: 1rem; overflow-y: auto; }
  .fq-empty { margin: 0; color: var(--muted); }
  .fq-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  .fq-row {
    display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
    flex-wrap: wrap; padding: 0.625rem 0.75rem;
    background: var(--surface); border: 1px solid var(--border); border-radius: 0.5rem;
  }
  .fq-info { display: grid; gap: 0.125rem; min-width: 0; }
  .fq-title { font-weight: 600; color: var(--text); overflow-wrap: anywhere; }
  .fq-meta { font-size: 0.8125rem; color: var(--muted); }
  .fq-footer {
    margin: 0; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
    flex-wrap: wrap; padding: 0.75rem 1rem; background: var(--surface);
    border-top: 1px solid var(--border);
  }
  .fq-count { font-size: 0.875rem; color: var(--muted); font-variant-numeric: tabular-nums; }
</style>
