<script lang="ts">
  import { bytes } from "../format.ts";
  import type { FsEntryMeta } from "./files-api.ts";
  import {
    entryBadgeText, entryKindLabel, formatMtime, type SortDir, type SortField,
  } from "./files-meta.ts";
  import FilesEntryMenu from "./FilesEntryMenu.svelte";

  let {
    entries,
    dirPath,
    busy,
    selectedName,
    selectedNames,
    previewName,
    openMenuName,
    renamingName,
    renameDraft = $bindable(""),
    confirmDeleteName,
    sortField,
    sortDir,
    onSortColumn,
    onToggleSelect,
    onToggleSelectAll,
    onActivate,
    onPreview,
    onToggleMenu,
    onCloseMenu,
    onStartRename,
    onSubmitRename,
    onCancelRename,
    onCopyPath,
    onZipEntry,
    onStartDelete,
    onConfirmDelete,
    onCancelDelete,
  }: {
    entries: readonly FsEntryMeta[];
    dirPath: string;
    busy: boolean;
    selectedName: string | null;
    selectedNames: ReadonlySet<string>;
    previewName: string | null;
    openMenuName: string | null;
    renamingName: string | null;
    renameDraft: string;
    confirmDeleteName: string | null;
    sortField: SortField;
    sortDir: SortDir;
    onSortColumn: (field: SortField) => void;
    onToggleSelect: (name: string) => void;
    onToggleSelectAll: () => void;
    onActivate: (entry: FsEntryMeta, event?: MouseEvent) => void;
    onPreview: (entry: FsEntryMeta) => void;
    onToggleMenu: (name: string) => void;
    onCloseMenu: () => void;
    onStartRename: (name: string) => void;
    onSubmitRename: (fromName: string) => void;
    onCancelRename: () => void;
    onCopyPath: (name: string) => void;
    onZipEntry: (name: string) => void;
    onStartDelete: (name: string) => void;
    onConfirmDelete: (name: string) => void;
    onCancelDelete: () => void;
  } = $props();

  let allSelected = $derived(entries.length > 0 && entries.every((e) => selectedNames.has(e.name)));
  const sortMark = (field: SortField) => (sortField === field ? (sortDir === "asc" ? " ^" : " v") : "");
</script>

<div class="explorer-table" data-view-mode="details">
  <div class="exp-head">
    <input
      type="checkbox"
      class="entry-check"
      aria-label="Select all entries"
      checked={allSelected}
      disabled={busy || entries.length === 0}
      onchange={onToggleSelectAll}
    />
    <button type="button" class="exp-sort-btn" onclick={() => onSortColumn("name")}>Name{sortMark("name")}</button>
    <button type="button" class="exp-sort-btn exp-col-mtime" onclick={() => onSortColumn("mtime")}>Modified{sortMark("mtime")}</button>
    <button type="button" class="exp-sort-btn exp-col-type" onclick={() => onSortColumn("kind")}>Type{sortMark("kind")}</button>
    <button type="button" class="exp-sort-btn exp-col-size" onclick={() => onSortColumn("size")}>Size{sortMark("size")}</button>
    <span class="exp-actions-head">Actions</span>
  </div>
  {#each entries as entry (entry.name)}
    {@const checked = selectedNames.has(entry.name)}
    <div class="exp-row" class:selected={checked || selectedName === entry.name || previewName === entry.name}>
      <input
        type="checkbox"
        class="entry-check"
        aria-label={`Select ${entry.name}`}
        checked={checked}
        disabled={busy}
        onchange={() => onToggleSelect(entry.name)}
      />
      {#if renamingName === entry.name}
        <form
          class="rename-inline-row"
          onsubmit={(e) => { e.preventDefault(); onSubmitRename(entry.name); }}
        >
          <label class="sr-only" for={`rename-exp-${entry.name}`}>Rename {entry.name}</label>
          <input
            id={`rename-exp-${entry.name}`}
            type="text"
            bind:value={renameDraft}
            disabled={busy}
            autocomplete="off"
            onkeydown={(e) => { if (e.key === "Escape") onCancelRename(); }}
          />
          <button type="submit" class="compact-btn primary" disabled={busy}>Save</button>
          <button type="button" class="compact-btn" disabled={busy} onclick={onCancelRename}>Cancel</button>
        </form>
      {:else}
        <button
          type="button"
          class="exp-open"
          disabled={busy}
          data-entry-open={entry.name}
          onclick={(e) => onActivate(entry, e)}
        >
          <span class="exp-glyph" class:dir={entry.kind === "dir"} aria-hidden="true">
            {entryBadgeText(entry)}
          </span>
          <span class="exp-name">{entry.name}</span>
        </button>
      {/if}
      <span class="exp-mtime">{formatMtime(entry.mtime)}</span>
      <span class="exp-type">{entryKindLabel(entry)}</span>
      <span class="exp-size">{entry.kind === "file" ? bytes(entry.size) : ""}</span>
      <div class="entry-actions">
        {#if confirmDeleteName === entry.name}
          <button type="button" class="compact-btn danger" disabled={busy} onclick={() => onConfirmDelete(entry.name)}>
            Confirm delete
          </button>
          <button type="button" class="compact-btn" disabled={busy} onclick={onCancelDelete}>Cancel</button>
        {:else}
          <FilesEntryMenu
            {entry}
            {dirPath}
            {busy}
            open={openMenuName === entry.name}
            onToggle={() => onToggleMenu(entry.name)}
            onClose={onCloseMenu}
            onOpen={() => onActivate(entry)}
            onPreview={() => onPreview(entry)}
            onRename={() => onStartRename(entry.name)}
            onCopyPath={() => onCopyPath(entry.name)}
            onZip={() => onZipEntry(entry.name)}
            onDelete={() => onStartDelete(entry.name)}
          />
          <button
            type="button"
            class="entry-delete"
            disabled={busy}
            data-delete-entry={entry.name}
            aria-label={`Delete ${entry.name}`}
            onclick={() => onStartDelete(entry.name)}
          >
            Delete
          </button>
        {/if}
      </div>
    </div>
  {/each}
</div>
