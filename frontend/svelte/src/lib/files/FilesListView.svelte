<script lang="ts">
  import { bytes } from "../format.ts";
  import type { FsEntryMeta } from "./files-api.ts";
  import { entryBadgeText, formatMtime } from "./files-meta.ts";
  import { joinFsPath } from "./files-path-utils.ts";
  import FilesEntryMenu from "./FilesEntryMenu.svelte";

  let {
    entries,
    dirPath,
    busy,
    variant,
    uid,
    selectedName,
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
    variant: string;
    uid: string;
    selectedName: string | null;
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
    onSubmitRename: (name: string) => void;
    onCancelRename: () => void;
    onCopyPath: (name: string) => void;
    onZipEntry: (name: string) => void;
    onStartDelete: (name: string) => void;
    onConfirmDelete: (name: string) => void;
    onCancelDelete: () => void;
  } = $props();
</script>

<ul class="entry-list" data-view-mode="list">
  {#each entries as entry (entry.name)}
    <li class="entry-item">
      <input type="checkbox" class="entry-check" aria-label={`Select ${entry.name}`} checked={selectedNames.has(entry.name)} disabled={busy} onchange={() => onToggleSelect(entry.name)} />
      {#if renamingName === entry.name}
        <form class="rename-inline-row" onsubmit={(e) => { e.preventDefault(); onSubmitRename(entry.name); }}>
          <label class="sr-only" for={`${uid}-rn-${entry.name}`}>Rename {entry.name}</label>
          <input id={`${uid}-rn-${entry.name}`} type="text" bind:value={renameDraft} disabled={busy} autocomplete="off" onkeydown={(e) => { if (e.key === "Escape") onCancelRename(); }} />
          <button type="submit" class="compact-btn primary" disabled={busy}>Save</button>
          <button type="button" class="compact-btn" disabled={busy} onclick={onCancelRename}>Cancel</button>
        </form>
      {:else}
        <button type="button" class="entry-row" class:is-dir={entry.kind === "dir"} class:selected={selectedNames.has(entry.name) || selectedName === entry.name || previewName === entry.name} disabled={busy} data-entry-open={entry.name} onclick={(e) => onActivate(entry, e)}>
          <span class="entry-name"><span class="kind-badge">{entryBadgeText(entry)}</span><span>{entry.name}</span></span>
          <span class="entry-trailing">
            {#if entry.mtime}<span class="mtime-badge">{formatMtime(entry.mtime)}</span>{/if}
            {#if entry.kind === "file"}<span class="size-badge">{bytes(entry.size)}</span>{/if}
            {#if variant === "ios-files" && entry.kind === "dir"}<span class="ios-chev" aria-hidden="true">&#8250;</span>{/if}
          </span>
        </button>
      {/if}
      <div class="entry-actions">
        {#if confirmDeleteName === entry.name}
          <button type="button" class="compact-btn danger" disabled={busy} onclick={() => onConfirmDelete(entry.name)}>Confirm delete</button>
          <button type="button" class="compact-btn" disabled={busy} onclick={onCancelDelete}>Cancel</button>
        {:else}
          <FilesEntryMenu {entry} {dirPath} {busy} open={openMenuName === entry.name} onToggle={() => onToggleMenu(entry.name)} onClose={onCloseMenu} onOpen={() => onActivate(entry)} onPreview={() => onPreview(entry)} onRename={() => onStartRename(entry.name)} onCopyPath={() => onCopyPath(joinFsPath(dirPath, entry.name))} onZip={() => onZipEntry(entry.name)} onDelete={() => onStartDelete(entry.name)} />
          <button type="button" class="entry-delete" disabled={busy} data-delete-entry={entry.name} aria-label={`Delete ${entry.name}`} onclick={() => onStartDelete(entry.name)}>Delete</button>
        {/if}
      </div>
    </li>
  {/each}
</ul>
