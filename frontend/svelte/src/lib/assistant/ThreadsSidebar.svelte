<script lang="ts">
  import "./ThreadsSidebar.css";
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
