<script lang="ts">
  import { baseName } from "./editor-api.ts";
  import type { EditorTab } from "./editor-tabs.ts";

  let {
    tabs,
    activePath,
    pendingClosePath,
    onSelect,
    onRequestClose,
    onSaveAndClose,
    onDiscardClose,
    onCancelClose,
    onNewFile,
  }: {
    tabs: EditorTab[];
    activePath: string | null;
    pendingClosePath: string | null;
    onSelect: (path: string) => void;
    onRequestClose: (path: string) => void;
    onSaveAndClose: (path: string) => void;
    onDiscardClose: (path: string) => void;
    onCancelClose: () => void;
    onNewFile: () => void;
  } = $props();

  function handleTabKeydown(event: KeyboardEvent, index: number): void {
    if (tabs.length < 2) return;
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next >= 0) {
      event.preventDefault();
      onSelect(tabs[next].path);
    }
  }
</script>

<div class="tabbar-wrap">
  <div class="tabbar" role="tablist" aria-label="Open editor buffers">
    {#each tabs as tab, idx (tab.path)}
      {@const active = tab.path === activePath}
      <div
        role="tab"
        aria-selected={active}
        tabindex={active ? 0 : -1}
        class="tab-item"
        class:active
        title={tab.path}
        onclick={() => onSelect(tab.path)}
        onkeydown={(e) => handleTabKeydown(e, idx)}
      >
        {#if tab.dirty}
          <span class="dirty-dot" title="Unsaved changes" aria-label="Unsaved changes"></span>
        {/if}
        <span class="tab-label">{baseName(tab.path)}</span>
        <button
          type="button"
          class="tab-close"
          aria-label={`Close ${baseName(tab.path)}`}
          onclick={(e) => { e.stopPropagation(); onRequestClose(tab.path); }}
        >x</button>
      </div>
    {/each}
    <button
      type="button"
      class="tab-add"
      title="New untitled buffer"
      aria-label="New file tab"
      onclick={onNewFile}
    >+</button>
  </div>

  {#if pendingClosePath}
    <div class="discard-guard" role="region" aria-label="Confirm closing unsaved tab">
      <span class="guard-text">
        Unsaved changes in <strong>{baseName(pendingClosePath)}</strong>.
      </span>
      <div class="guard-actions">
        <button type="button" class="primary guard-btn" onclick={() => onSaveAndClose(pendingClosePath)}>
          Save and close
        </button>
        <button type="button" class="danger guard-btn" onclick={() => onDiscardClose(pendingClosePath)}>
          Discard
        </button>
        <button type="button" class="guard-btn" onclick={onCancelClose}>
          Cancel
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .tabbar-wrap { border-bottom: 1px solid var(--border); background: var(--panel); }
  .tabbar {
    display: flex; align-items: stretch; overflow-x: auto; scrollbar-width: thin;
    min-height: 2.15rem;
  }
  .tab-item {
    display: inline-flex; align-items: center; gap: 0.35rem; flex: 0 0 auto;
    max-width: 13rem; padding: 0.25rem 0.5rem 0.25rem 0.65rem;
    border-right: 1px solid var(--border); border-top: 2px solid transparent;
    color: var(--muted); font-size: 0.8rem; cursor: pointer; user-select: none;
  }
  .tab-item:hover { background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--text); }
  .tab-item.active {
    background: var(--panel-solid); color: var(--text);
    border-top-color: var(--accent); font-weight: 600;
  }
  .tab-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dirty-dot {
    width: 0.48rem; height: 0.48rem; border-radius: 999px;
    background: var(--warn); flex-shrink: 0;
  }
  .tab-close {
    min-height: 1.35rem; min-width: 1.35rem; padding: 0; border: 0; border-radius: 0.25rem;
    background: transparent; color: var(--muted); font-size: 0.72rem; font-family: var(--font-mono);
    display: inline-flex; align-items: center; justify-content: center;
  }
  .tab-close:hover { background: color-mix(in srgb, var(--danger) 16%, transparent); color: var(--danger); }
  .tab-add {
    min-height: 2.15rem; min-width: 2.15rem; padding: 0; border: 0; border-radius: 0;
    background: transparent; color: var(--muted); font-size: 0.95rem; font-family: var(--font-mono);
  }
  .tab-add:hover { color: var(--text); background: color-mix(in srgb, var(--accent) 10%, transparent); }
  .discard-guard {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
    flex-wrap: wrap; padding: 0.45rem 0.65rem;
    background: var(--warn-bg); color: var(--warn); border-top: 1px solid var(--warn);
    font-size: 0.8rem;
  }
  .guard-actions { display: flex; gap: 0.375rem; flex-wrap: wrap; }
  .guard-btn { min-height: 1.85rem; padding: 0.2rem 0.55rem; font-size: 0.76rem; }
</style>
