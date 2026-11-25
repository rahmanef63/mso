<script lang="ts">
  import { bytes } from "../format.ts";
  import type { FsEntryMeta } from "./files-api.ts";
  import { buildRawFileUrl } from "./files-extended-api.ts";
  import { entryBadgeText, mediaKindFor } from "./files-meta.ts";
  import { joinFsPath } from "./files-path-utils.ts";
  import FilesEntryMenu from "./FilesEntryMenu.svelte";

  let {
    entries,
    dirPath,
    busy,
    selectedNames,
    previewName,
    openMenuName,
    renamingName,
    renameDraft = $bindable(""),
    confirmDeleteName,
    onToggleSelect,
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
    selectedNames: ReadonlySet<string>;
    previewName: string | null;
    openMenuName: string | null;
    renamingName: string | null;
    renameDraft: string;
    confirmDeleteName: string | null;
    onToggleSelect: (name: string) => void;
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

  function thumbUrl(entry: FsEntryMeta): string {
    if (entry.kind !== "file" || mediaKindFor(entry) !== "image") return "";
    try {
      return buildRawFileUrl(joinFsPath(dirPath, entry.name));
    } catch {
      return "";
    }
  }
</script>

<ul class="icon-grid" data-view-mode="grid">
  {#each entries as entry (entry.name)}
    {@const checked = selectedNames.has(entry.name)}
    {@const thumb = thumbUrl(entry)}
    <li class="icon-cell" class:selected={checked || previewName === entry.name}>
      <div class="icon-cell-top">
        <input
          type="checkbox"
          class="entry-check"
          aria-label={`Select ${entry.name}`}
          checked={checked}
          disabled={busy}
          onchange={() => onToggleSelect(entry.name)}
        />
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
      </div>

      {#if renamingName === entry.name}
        <form
          class="rename-inline-form"
          onsubmit={(e) => { e.preventDefault(); onSubmitRename(entry.name); }}
        >
          <label class="sr-only" for={`rename-grid-${entry.name}`}>Rename {entry.name}</label>
          <input
            id={`rename-grid-${entry.name}`}
            type="text"
            bind:value={renameDraft}
            disabled={busy}
            autocomplete="off"
            onkeydown={(e) => { if (e.key === "Escape") onCancelRename(); }}
          />
          <div class="rename-inline-actions">
            <button type="submit" class="compact-btn primary" disabled={busy}>Save</button>
            <button type="button" class="compact-btn" disabled={busy} onclick={onCancelRename}>Cancel</button>
          </div>
        </form>
      {:else}
        <button
          type="button"
          class="icon-open"
          class:is-dir={entry.kind === "dir"}
          disabled={busy}
          data-entry-open={entry.name}
          onclick={(e) => onActivate(entry, e)}
        >
          {#if thumb}
            <img class="icon-thumb" src={thumb} alt="" loading="lazy" />
          {:else if entry.kind === "dir"}
            <svg class="icon-folder" viewBox="0 0 24 24" aria-hidden="true"><use href="#g-folder-fill" /></svg>
          {:else}
            <span class="icon-art" aria-hidden="true">
              <span class="icon-art-ext">{entryBadgeText(entry)}</span>
            </span>
          {/if}
          <span class="icon-label">{entry.name}</span>
          <span class="icon-sub">{entry.kind === "file" ? bytes(entry.size) : "Folder"}</span>
        </button>
      {/if}

      {#if confirmDeleteName === entry.name}
        <div class="icon-cell-actions">
          <button type="button" class="compact-btn danger" disabled={busy} onclick={() => onConfirmDelete(entry.name)}>
            Confirm delete
          </button>
          <button type="button" class="compact-btn" disabled={busy} onclick={onCancelDelete}>Cancel</button>
        </div>
      {/if}
    </li>
  {/each}
</ul>
