<script lang="ts">
  import { tick } from "svelte";
  import { filterCommands, type CommandItem } from "./command-palette.ts";

  let {
    open,
    items,
    onClose,
  }: {
    open: boolean;
    items: CommandItem[];
    onClose: () => void;
  } = $props();

  let view = $state({ query: "", activeIndex: 0 });
  let inputEl = $state<HTMLInputElement | null>(null);

  let results = $derived(filterCommands(items, view.query));
  let safeIndex = $derived(
    results.length === 0 ? -1 : Math.min(view.activeIndex, results.length - 1),
  );
  let activeId = $derived(safeIndex >= 0 ? `cmd-opt-${results[safeIndex].id}` : undefined);

  $effect(() => {
    if (!open) return;
    view.query = "";
    view.activeIndex = 0;
    void tick().then(() => {
      inputEl?.focus();
    });
  });

  function runCommand(item: CommandItem) {
    onClose();
    item.run();
  }

  function clearQuery() {
    view.query = "";
    view.activeIndex = 0;
    inputEl?.focus();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  function handleInputKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      view.activeIndex = (safeIndex + 1) % results.length;
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      view.activeIndex = (safeIndex - 1 + results.length) % results.length;
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (safeIndex >= 0) runCommand(results[safeIndex]);
    }
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open}
  <div class="palette-layer">
    <button
      type="button"
      class="palette-backdrop"
      aria-label="Close command palette"
      tabindex="-1"
      onclick={onClose}
    ></button>

    <div
      class="palette-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div class="palette-header">
        <label class="sr-only" for="shell-command-input">Search commands</label>
        <input
          id="shell-command-input"
          bind:this={inputEl}
          type="search"
          class="palette-input"
          placeholder="Type a command or search..."
          autocomplete="off"
          role="combobox"
          aria-expanded="true"
          aria-controls="shell-command-listbox"
          aria-activedescendant={activeId}
          value={view.query}
          oninput={(event) => {
            view.query = (event.currentTarget as HTMLInputElement).value;
            view.activeIndex = 0;
          }}
          onkeydown={handleInputKeydown}
        />
        {#if view.query}
          <button type="button" class="palette-btn" onclick={clearQuery}>Clear</button>
        {/if}
        <button type="button" class="palette-btn" onclick={onClose}>Close</button>
      </div>

      {#if results.length === 0}
        <div class="palette-empty" role="status">
          <p>No commands match "{view.query.trim() || "current filter"}".</p>
          {#if view.query}
            <button type="button" onclick={clearQuery}>Reset search</button>
          {/if}
        </div>
      {:else}
        <ul id="shell-command-listbox" class="palette-list" role="listbox" aria-label="Commands">
          {#each results as item, index (item.id)}
            <li
              id={`cmd-opt-${item.id}`}
              role="option"
              aria-selected={index === safeIndex}
            >
              <button
                type="button"
                class="palette-item"
                class:active={index === safeIndex}
                onpointerenter={() => { view.activeIndex = index; }}
                onfocus={() => { view.activeIndex = index; }}
                onclick={() => runCommand(item)}
              >
                <span class="item-main">
                  <span class="item-label">{item.label}</span>
                  <span class="item-category">{item.category}</span>
                </span>
                {#if item.shortcut}
                  <kbd class="item-shortcut">{item.shortcut}</kbd>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

<style>
  .palette-layer {
    position: fixed; inset: 0; z-index: 60;
    display: grid; place-items: start center; padding: 10vh 1rem 1rem;
  }
  .palette-backdrop {
    position: fixed; inset: 0; min-height: 0; padding: 0; border: 0; border-radius: 0;
    background: rgba(0, 0, 0, 0.45); cursor: default;
  }
  .palette-dialog {
    position: relative; z-index: 1; width: min(36rem, 100%); max-height: 75vh;
    display: grid; grid-template-rows: auto minmax(0, 1fr);
    background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: .75rem; overflow: hidden;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
  }
  .palette-header {
    display: flex; align-items: center; gap: .5rem; padding: .75rem;
    background: var(--surface); border-bottom: 1px solid var(--border);
  }
  .palette-input { flex: 1 1 auto; min-width: 0; min-height: var(--ui-control-height); }
  .palette-btn { flex-shrink: 0; padding: .5rem .75rem; }
  .palette-list {
    list-style: none; margin: 0; padding: .5rem; overflow-y: auto; display: grid; gap: .25rem;
  }
  .palette-item {
    width: 100%; display: flex; align-items: center; justify-content: space-between; gap: .75rem;
    text-align: left; background: transparent; border-color: transparent; padding: .5rem .75rem;
  }
  .palette-item:hover, .palette-item.active {
    background: var(--surface); border-color: var(--accent);
  }
  .item-main { display: grid; gap: .125rem; min-width: 0; }
  .item-label { color: var(--text); font-weight: 600; overflow-wrap: anywhere; }
  .item-category { font-size: .8125rem; color: var(--muted); }
  .item-shortcut {
    flex-shrink: 0; padding: .125rem .45rem; font-size: .75rem; font-family: inherit;
    color: var(--text); background: var(--surface);
    border: 1px solid var(--border); border-radius: .25rem;
  }
  .palette-empty {
    padding: 1.5rem 1rem; display: grid; justify-items: center; gap: .75rem; text-align: center;
  }
  .palette-empty p { margin: 0; color: var(--muted); }
</style>
