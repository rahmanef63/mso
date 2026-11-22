<script lang="ts">
  import {
    CLIPBOARD_HARD_MAX,
    filterClipboardItems,
    getSharedClipboardStore,
    type ClipboardItem,
    type ClipboardStore,
  } from "./clipboard-store.ts";

  let { store }: { store?: ClipboardStore } = $props();

  let activeStore = $derived(store ?? getSharedClipboardStore());
  let view = $state({
    items: [] as readonly ClipboardItem[],
    draft: "",
    query: "",
    statusText: "",
    statusTone: "" as "" | "ok" | "error",
  });

  let filtered = $derived(filterClipboardItems(view.items, view.query));

  $effect(() => {
    const target = activeStore;
    return target.subscribe((next) => {
      view.items = next;
    });
  });

  function setStatus(text: string, tone: "ok" | "error") {
    view.statusText = text;
    view.statusTone = tone;
  }

  function handleAdd(event: SubmitEvent) {
    event.preventDefault();
    const raw = view.draft;
    if (!raw.trim()) {
      setStatus("Enter text before adding a snippet.", "error");
      return;
    }
    const hadTopSame = view.items.length > 0 && view.items[0].text === raw;
    activeStore.add(raw);
    view.draft = "";
    setStatus(
      hadTopSame ? "Snippet already matches the latest entry." : "Snippet saved to clipboard history.",
      "ok",
    );
  }

  async function handleCopy(item: ClipboardItem) {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      setStatus("Clipboard API is unavailable in this browser context.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(item.text);
      setStatus("Copied snippet to system clipboard.", "ok");
    } catch {
      setStatus("Could not copy snippet. Check browser clipboard permissions.", "error");
    }
  }

  function handleRemove(id: string) {
    if (activeStore.remove(id)) {
      setStatus("Removed snippet from clipboard history.", "ok");
    }
  }

  function handleClearAll() {
    if (view.items.length === 0) return;
    activeStore.clear();
    setStatus("Cleared all clipboard snippets.", "ok");
  }
</script>

<div class="clipboard-panel">
  <header class="feature-header">
    <div>
      <h3>Clipboard history</h3>
      <p class="clip-meta">{view.items.length} / {CLIPBOARD_HARD_MAX} snippets stored in session</p>
    </div>
    <button
      type="button"
      class="danger"
      disabled={view.items.length === 0}
      onclick={handleClearAll}
    >
      Clear all
    </button>
  </header>

  <form class="clip-form" onsubmit={handleAdd}>
    <label class="sr-only" for="clipboard-snippet-input">New clipboard snippet</label>
    <textarea
      id="clipboard-snippet-input"
      rows="2"
      placeholder="Paste or type a snippet to store..."
      bind:value={view.draft}
    ></textarea>
    <div class="actions">
      <button type="submit" class="primary">Add snippet</button>
      {#if view.draft}
        <button type="button" onclick={() => { view.draft = ""; }}>Clear input</button>
      {/if}
    </div>
  </form>

  <div class="clip-search">
    <label class="sr-only" for="clipboard-search-input">Search snippets</label>
    <input
      id="clipboard-search-input"
      type="search"
      placeholder="Filter snippets..."
      bind:value={view.query}
    />
    {#if view.query}
      <button type="button" onclick={() => { view.query = ""; }}>Reset</button>
    {/if}
  </div>

  {#if view.statusText}
    <p class="feedback" class:ok={view.statusTone === "ok"} class:error={view.statusTone === "error"} role="status">
      {view.statusText}
    </p>
  {/if}

  {#if filtered.length === 0}
    <p class="clip-empty">
      {view.items.length === 0
        ? "No snippets saved yet. Add one above to keep it ready."
        : `No snippets match "${view.query.trim()}".`}
    </p>
  {:else}
    <ul class="clip-list" aria-label="Saved clipboard snippets">
      {#each filtered as item (item.id)}
        <li class="clip-item">
          <pre class="clip-text">{item.text}</pre>
          <div class="clip-row-footer">
            <span class="clip-time">{item.text.length} chars</span>
            <div class="actions">
              <button type="button" onclick={() => void handleCopy(item)}>Copy</button>
              <button type="button" class="danger" onclick={() => handleRemove(item.id)}>Remove</button>
            </div>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .clipboard-panel { display: grid; gap: 0.75rem; min-width: 0; }
  .clip-meta { margin: 0.125rem 0 0; font-size: 0.8125rem; color: var(--muted); }
  .clip-form { display: grid; gap: 0.5rem; }
  .clip-form textarea {
    width: 100%; padding: 0.5rem 0.75rem; font: inherit; resize: vertical;
    background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: 0.375rem;
  }
  .clip-search { display: flex; gap: 0.5rem; align-items: center; }
  .clip-search input { flex: 1 1 auto; min-width: 0; }
  .clip-empty { margin: 0; color: var(--muted); font-size: 0.875rem; }
  .clip-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  .clip-item {
    display: grid; gap: 0.5rem; padding: 0.625rem 0.75rem;
    background: var(--surface); border: 1px solid var(--border); border-radius: 0.5rem;
  }
  .clip-text {
    margin: 0; font-family: inherit; font-size: 0.875rem; color: var(--text);
    white-space: pre-wrap; overflow-wrap: anywhere; max-height: 7rem; overflow-y: auto;
  }
  .clip-row-footer {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;
  }
  .clip-time { font-size: 0.75rem; color: var(--muted); font-variant-numeric: tabular-nums; }
</style>
