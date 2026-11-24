<script lang="ts">
  // Tab strip: select, rename (inline, no prompt), close, and add. Closing the
  // last tab reopens a fresh one, so the workspace is never empty.
  import { MAX_TABS, type Tab } from "./term-tabs";

  let {
    tabs,
    activeId,
    statuses = {},
    onselect,
    onadd,
    onclose,
    onrename,
  }: {
    tabs: Tab[];
    activeId: number;
    statuses?: Record<number, string>;
    onselect: (id: number) => void;
    onadd: () => void;
    onclose: (id: number) => void;
    onrename: (id: number, title: string) => void;
  } = $props();

  let editingId = $state<number | null>(null);
  let draft = $state("");

  function startRename(tab: Tab) {
    editingId = tab.id;
    draft = tab.title;
  }

  function commit() {
    if (editingId === null) return;
    onrename(editingId, draft);
    editingId = null;
  }

  function cancel() {
    editingId = null;
    draft = "";
  }
</script>

<div class="tabstrip" role="tablist" aria-label="Terminal sessions">
  {#each tabs as tab (tab.id)}
    <div class="tab" class:selected={tab.id === activeId}>
      {#if editingId === tab.id}
        <label class="sr-only" for="term-tab-name">Tab name</label>
        <input
          id="term-tab-name"
          class="rename"
          bind:value={draft}
          onkeydown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); commit(); }
            else if (event.key === "Escape") { event.preventDefault(); cancel(); }
          }}
          onblur={commit}
          autocomplete="off"
          maxlength="40"
        />
      {:else}
        <button
          type="button"
          role="tab"
          class="tab-select"
          aria-selected={tab.id === activeId}
          onclick={() => onselect(tab.id)}
          ondblclick={() => startRename(tab)}
          title={`${tab.title} (double click to rename)`}
        >
          <span class="dot" data-state={statuses[tab.id] ?? "disconnected"} aria-hidden="true"></span>
          <span class="label">{tab.title}</span>
        </button>
        <button type="button" class="tab-btn" aria-label={`Rename ${tab.title}`} title="Rename tab"
          onclick={() => startRename(tab)}>Rename</button>
        <button type="button" class="tab-btn" aria-label={`Close ${tab.title}`} title="Close tab"
          onclick={() => onclose(tab.id)}>Close</button>
      {/if}
    </div>
  {/each}
  <button
    type="button"
    class="add"
    aria-label="New terminal tab"
    title={tabs.length >= MAX_TABS ? `Maximum ${MAX_TABS} tabs` : "New tab"}
    disabled={tabs.length >= MAX_TABS}
    onclick={onadd}
  >+ New Tab</button>
</div>

<style>
  .tabstrip {
    display: flex; align-items: stretch; gap: 0.25rem; overflow-x: auto;
    padding-bottom: 0.25rem; min-width: 0; scrollbar-width: thin;
  }
  .tab {
    display: flex; align-items: center; flex: 0 0 auto; gap: 0.125rem;
    max-width: 14rem; min-width: 8rem; border: 1px solid var(--border);
    border-radius: 0.5rem 0.5rem 0 0; background: var(--surface);
  }
  .tab.selected { background: var(--panel-solid); border-bottom-color: transparent; }
  .tab-select {
    display: flex; align-items: center; gap: 0.375rem; flex: 1 1 auto; min-width: 0;
    min-height: 2.25rem; padding: 0 0.5rem; border: 0; background: transparent;
    color: inherit; cursor: pointer; text-align: left;
  }
  .label { font-size: 0.75rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: 0.5rem; height: 0.5rem; border-radius: 999px; flex: 0 0 auto; background: var(--muted); }
  .dot[data-state="connected"] { background: var(--ok); }
  .dot[data-state="connecting"] { background: var(--warn); }
  .dot[data-state="error"] { background: var(--danger); }
  .tab-btn {
    flex: 0 0 auto; min-height: 2.25rem; padding: 0 0.375rem; border: 0; border-radius: 0.25rem;
    background: transparent; color: var(--muted); cursor: pointer; font-size: 0.6875rem;
  }
  .tab-btn:hover { background: var(--surface); color: var(--text); }
  .rename { width: 7rem; min-height: 2.25rem; margin: 0 0.25rem; font-size: 0.75rem; }
  .add {
    flex: 0 0 auto; min-height: 2.25rem; padding: 0 0.625rem; border: 1px dashed var(--border);
    border-radius: 0.5rem; background: transparent; color: var(--muted); cursor: pointer; font-size: 0.75rem;
  }
  .add:hover:not(:disabled) { color: var(--text); border-color: var(--accent); }
  .add:disabled { opacity: 0.5; cursor: not-allowed; }
  @media (pointer: coarse) {
    .tab-select, .tab-btn, .add { min-height: 2.75rem; }
    .tab-btn { font-size: 0.75rem; padding: 0 0.5rem; }
  }
</style>
