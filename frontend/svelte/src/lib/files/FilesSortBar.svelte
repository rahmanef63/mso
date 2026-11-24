<script lang="ts">
  import type { FilesPresentation } from "../shell/shell-design.ts";
  import type { SortDir, SortField } from "./files-meta.ts";

  let {
    uid,
    variant,
    currentPath,
    busy,
    sortField,
    sortDir,
    showHidden,
    filterText = $bindable(""),
    totalCount,
    selectedCount,
    onSortField,
    onToggleSortDir,
    onToggleHidden,
    onSelectAll,
    onClearSelection,
    onBatchTransfer,
    onBatchZip,
    onBatchDelete,
  }: {
    uid: string;
    variant: FilesPresentation;
    currentPath: string;
    busy: boolean;
    sortField: SortField;
    sortDir: SortDir;
    showHidden: boolean;
    filterText: string;
    totalCount: number;
    selectedCount: number;
    onSortField: (field: SortField) => void;
    onToggleSortDir: () => void;
    onToggleHidden: () => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onBatchTransfer: (mode: "copy" | "move", destDir: string) => void;
    onBatchZip: () => void;
    onBatchDelete: () => void;
  } = $props();

  let batchMode = $state<"copy" | "move" | null>(null);
  let batchDest = $state("");
  let confirmBatchDelete = $state(false);

  $effect(() => {
    if (selectedCount === 0) {
      batchMode = null;
      confirmBatchDelete = false;
    }
  });

  function openBatchTransfer(mode: "copy" | "move") {
    confirmBatchDelete = false;
    if (batchMode === mode) {
      batchMode = null;
      return;
    }
    batchMode = mode;
    batchDest = currentPath;
  }

  function submitBatchTransfer(event: SubmitEvent) {
    event.preventDefault();
    if (!batchMode || !batchDest.trim()) return;
    const mode = batchMode;
    const dest = batchDest.trim();
    batchMode = null;
    onBatchTransfer(mode, dest);
  }
</script>

<div class="files-controls-wrap">
  <div class="files-sortbar" role="toolbar" aria-label="Sort and filter options">
    <div class="sort-group">
      <label class="sort-label" for={`${uid}-sort-field`}>Sort</label>
      <select
        id={`${uid}-sort-field`}
        class="sort-select"
        value={sortField}
        onchange={(e) => onSortField((e.currentTarget as HTMLSelectElement).value as SortField)}
      >
        <option value="name">Name</option>
        <option value="size">Size</option>
        <option value="mtime">Modified</option>
        <option value="kind">Kind</option>
      </select>
      <button
        type="button"
        class="compact-btn"
        aria-label={`Sort order: ${sortDir === "asc" ? "ascending" : "descending"}`}
        onclick={onToggleSortDir}
      >
        {sortDir === "asc" ? "Asc" : "Desc"}
      </button>
    </div>

    <button
      type="button"
      class="compact-btn"
      class:active={showHidden}
      aria-pressed={showHidden}
      onclick={onToggleHidden}
    >
      {showHidden ? "Hide dotfiles" : "Show dotfiles"}
    </button>

    {#if variant === "finder" || variant === "dashboard"}
      <label class="sr-only" for={`${uid}-quick-filter`}>Quick filter current folder</label>
      <input
        id={`${uid}-quick-filter`}
        class="quick-filter"
        type="search"
        bind:value={filterText}
        placeholder="Filter folder..."
      />
    {/if}
  </div>

  {#if selectedCount > 0}
    <div class="batch-bar" role="region" aria-label="Selected items actions" data-batch-bar>
      <span class="batch-count">{selectedCount} selected</span>
      <div class="batch-actions">
        {#if selectedCount < totalCount}
          <button type="button" class="compact-btn" disabled={busy} onclick={onSelectAll}>Select all</button>
        {/if}
        <button type="button" class="compact-btn" disabled={busy} onclick={onClearSelection}>Clear</button>
        <button type="button" class="compact-btn" class:primary={batchMode === "copy"} disabled={busy} onclick={() => openBatchTransfer("copy")}>
          Copy
        </button>
        <button type="button" class="compact-btn" class:primary={batchMode === "move"} disabled={busy} onclick={() => openBatchTransfer("move")}>
          Move
        </button>
        <button type="button" class="compact-btn" disabled={busy} onclick={onBatchZip}>Zip</button>
        {#if confirmBatchDelete}
          <button
            type="button"
            class="compact-btn danger"
            disabled={busy}
            onclick={() => { confirmBatchDelete = false; onBatchDelete(); }}
          >
            Confirm delete ({selectedCount})
          </button>
          <button type="button" class="compact-btn" disabled={busy} onclick={() => { confirmBatchDelete = false; }}>
            Cancel
          </button>
        {:else}
          <button
            type="button"
            class="compact-btn danger"
            disabled={busy}
            onclick={() => { batchMode = null; confirmBatchDelete = true; }}
          >
            Delete ({selectedCount})
          </button>
        {/if}
      </div>

      {#if batchMode}
        <form class="batch-dest-form" onsubmit={submitBatchTransfer}>
          <label for={`${uid}-batch-dest`}>
            {batchMode === "copy" ? "Copy selected to folder" : "Move selected to folder"}
          </label>
          <div class="inline-form-row">
            <input
              id={`${uid}-batch-dest`}
              type="text"
              bind:value={batchDest}
              disabled={busy}
              placeholder={currentPath}
              autocomplete="off"
            />
            <button type="submit" class="primary compact-btn" disabled={busy}>
              {batchMode === "copy" ? "Copy here" : "Move here"}
            </button>
            <button type="button" class="compact-btn" disabled={busy} onclick={() => { batchMode = null; }}>
              Cancel
            </button>
          </div>
        </form>
      {/if}
    </div>
  {/if}
</div>
