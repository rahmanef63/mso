<script lang="ts">
  import { bytes } from "../format.ts";
  import type { FsEntry } from "./files-api.ts";

  let {
    entries,
    busy,
    selectedName,
    previewName,
    confirmDeleteName,
    onActivate,
    onStartDelete,
    onConfirmDelete,
    onCancelDelete,
  }: {
    entries: readonly FsEntry[];
    busy: boolean;
    selectedName: string | null;
    previewName: string | null;
    confirmDeleteName: string | null;
    onActivate: (entry: FsEntry) => void;
    onStartDelete: (name: string) => void;
    onConfirmDelete: (name: string) => void;
    onCancelDelete: () => void;
  } = $props();
</script>

<div class="explorer-table">
  <div class="exp-head" aria-hidden="true">
    <span>Name</span>
    <span>Type</span>
    <span>Size</span>
    <span>Actions</span>
  </div>
  {#each entries as entry (entry.name)}
    <div class="exp-row" class:selected={selectedName === entry.name || previewName === entry.name}>
      <button
        type="button"
        class="exp-open"
        disabled={busy}
        data-entry-open={entry.name}
        onclick={() => onActivate(entry)}
      >
        <span class="exp-glyph" class:dir={entry.kind === "dir"} aria-hidden="true">
          {entry.kind === "dir" ? "DIR" : "DOC"}
        </span>
        <span class="exp-name">{entry.name}</span>
      </button>
      <span class="exp-type">{entry.kind === "dir" ? "File folder" : "File"}</span>
      <span class="exp-size">{entry.kind === "file" ? bytes(entry.size) : ""}</span>
      <div class="entry-actions">
        {#if confirmDeleteName === entry.name}
          <button type="button" class="danger" disabled={busy} onclick={() => onConfirmDelete(entry.name)}>
            Confirm delete
          </button>
          <button type="button" disabled={busy} onclick={onCancelDelete}>Cancel</button>
        {:else}
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
