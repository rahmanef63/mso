<script lang="ts">
  import { formatRelativeTime } from "./assistant-presets";
  import type { EndpointStatus, ThreadSummary } from "./assistant-types";

  let {
    threads,
    activeThreadId,
    status,
    note,
    onSelect,
    onNew,
    onRename,
    onDelete,
    onClose,
  }: {
    threads: ThreadSummary[];
    activeThreadId: string | null;
    status: EndpointStatus;
    note: string | null;
    onSelect: (id: string) => void;
    onNew: () => void;
    onRename: (id: string, title: string) => void;
    onDelete: (id: string) => void;
    onClose?: () => void;
  } = $props();

  let query = $state("");
  let confirmDeleteId = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let editingTitle = $state("");

  let visibleThreads = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter((t) => t.title.toLowerCase().includes(needle));
  });

  function beginRename(thread: ThreadSummary) {
    confirmDeleteId = null;
    editingId = thread.id;
    editingTitle = thread.title;
  }

  function commitRename(id: string) {
    const clean = editingTitle.trim();
    if (clean) onRename(id, clean);
    editingId = null;
  }

  function confirmDelete(id: string) {
    confirmDeleteId = null;
    onDelete(id);
  }
</script>

<aside class="threads-pane" aria-label="Conversation threads">
  <div class="pane-head">
    <div class="pane-title-row">
      <h3>Threads</h3>
      <span class="count-pill">{threads.length}</span>
    </div>
    <div class="pane-head-actions">
      <button type="button" class="compact-btn primary" onclick={onNew}>New</button>
      {#if onClose}
        <button type="button" class="compact-btn close-mobile" onclick={onClose} aria-label="Close threads">Close</button>
      {/if}
    </div>
  </div>

  <label class="search-wrap" for="assistant-thread-search">
    <span class="sr-only">Search threads</span>
    <input
      id="assistant-thread-search"
      type="search"
      bind:value={query}
      placeholder="Search threads..."
      autocomplete="off"
    />
  </label>

  {#if note && status !== "ready"}
    <p class="pane-note" role="status">{note}</p>
  {/if}

  <div class="thread-list" role="list">
    {#if status === "loading" && threads.length === 0}
      <p class="pane-empty" role="status">Loading threads...</p>
    {:else if visibleThreads.length === 0}
      <p class="pane-empty">{query.trim() ? "No matching threads." : "No saved threads yet."}</p>
    {:else}
      {#each visibleThreads as thread (thread.id)}
        <div class="thread-row" class:active={thread.id === activeThreadId} role="listitem">
          {#if confirmDeleteId === thread.id}
            <div class="confirm-strip" role="group" aria-label={`Confirm delete ${thread.title}`}>
              <span class="confirm-label">Delete chat?</span>
              <div class="confirm-actions">
                <button type="button" class="compact-btn danger" onclick={() => confirmDelete(thread.id)}>Confirm</button>
                <button type="button" class="compact-btn" onclick={() => { confirmDeleteId = null; }}>Cancel</button>
              </div>
            </div>
          {:else if editingId === thread.id}
            <form class="rename-strip" onsubmit={(e) => { e.preventDefault(); commitRename(thread.id); }}>
              <input
                type="text"
                aria-label="Rename thread"
                bind:value={editingTitle}
                onkeydown={(e) => { if (e.key === "Escape") editingId = null; }}
              />
              <button type="submit" class="compact-btn primary">Save</button>
              <button type="button" class="compact-btn" onclick={() => { editingId = null; }}>Cancel</button>
            </form>
          {:else}
            <button
              type="button"
              class="thread-select"
              aria-current={thread.id === activeThreadId ? "true" : undefined}
              onclick={() => onSelect(thread.id)}
            >
              <span class="thread-title">{thread.title}</span>
              <span class="thread-time">{formatRelativeTime(thread.updatedAt)}</span>
            </button>
            <div class="thread-item-actions">
              <button
                type="button"
                class="icon-action"
                aria-label={`Rename ${thread.title}`}
                onclick={() => beginRename(thread)}
              >
                Edit
              </button>
              <button
                type="button"
                class="icon-action danger-text"
                aria-label={`Delete ${thread.title}`}
                onclick={() => { confirmDeleteId = thread.id; editingId = null; }}
              >
                Del
              </button>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</aside>

<style>
  .threads-pane {
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr);
    gap: 0.5rem;
    padding: 0.65rem;
    border: 1px solid var(--border);
    border-radius: 0.625rem;
    background: var(--surface);
    min-width: 0;
    max-width: 100%;
    max-height: 36rem;
  }
  .pane-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .pane-title-row { display: inline-flex; align-items: center; gap: 0.35rem; }
  .pane-head-actions { display: inline-flex; gap: 0.3rem; }
  .count-pill {
    font-size: 0.72rem;
    font-weight: 600;
    padding: 0.08rem 0.4rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--panel-solid);
    color: var(--muted);
  }
  .search-wrap { display: block; min-width: 0; }
  .search-wrap input { width: 100%; min-width: 0; font-size: 0.85rem; }
  .pane-note, .pane-empty {
    margin: 0;
    font-size: 0.78rem;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .thread-list {
    display: grid;
    align-content: start;
    gap: 0.35rem;
    overflow-y: auto;
    min-width: 0;
  }
  .thread-row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    border: 1px solid var(--border);
    border-radius: 0.45rem;
    background: var(--panel-solid);
    padding: 0.2rem;
    min-width: 0;
  }
  .thread-row.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--panel-solid));
  }
  .thread-select {
    flex: 1 1 auto;
    min-width: 0;
    border: 0;
    background: transparent;
    text-align: left;
    display: grid;
    gap: 0.1rem;
    padding: 0.3rem 0.45rem;
  }
  .thread-title {
    font-size: 0.83rem;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .thread-time { font-size: 0.72rem; color: var(--muted); }
  .thread-item-actions { display: inline-flex; gap: 0.2rem; flex-shrink: 0; }
  .compact-btn, .icon-action {
    min-height: 2rem;
    padding: 0.2rem 0.45rem;
    font-size: 0.75rem;
  }
  .danger-text { color: var(--danger); }
  .confirm-strip, .rename-strip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.3rem;
    flex-wrap: wrap;
    width: 100%;
    padding: 0.25rem 0.35rem;
    min-width: 0;
  }
  .confirm-label { font-size: 0.78rem; font-weight: 600; color: var(--danger); }
  .confirm-actions { display: inline-flex; gap: 0.25rem; }
  .rename-strip input { flex: 1 1 6rem; min-width: 0; min-height: 2rem; font-size: 0.8rem; }
</style>
