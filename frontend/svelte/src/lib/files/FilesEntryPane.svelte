<script lang="ts">
  import type { FsEntryMeta } from "./files-api.ts";
  import { joinFsPath } from "./files-path-utils.ts";
  import FilesExplorerTable from "./FilesExplorerTable.svelte";
  import FilesGridView from "./FilesGridView.svelte";
  import FilesListView from "./FilesListView.svelte";
  import type { SortDir, SortField } from "./files-meta.ts";

  let {
    mode,
    variant = "finder",
    uid = "files",
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
    mode: "grid" | "table" | "list";
    variant?: string;
    uid?: string;
    selectedName: string | null;
    entries: readonly FsEntryMeta[];
    dirPath: string;
    busy: boolean;
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
    onSubmitRename: (name: string) => void;
    onCancelRename: () => void;
    onCopyPath: (name: string) => void;
    onZipEntry: (name: string) => void;
    onStartDelete: (name: string) => void;
    onConfirmDelete: (name: string) => void;
    onCancelDelete: () => void;
  } = $props();

  const copy = (name: string) => onCopyPath(joinFsPath(dirPath, name));
</script>

{#if mode === "grid"}
  <FilesGridView
    {entries} {dirPath} {busy} {selectedNames} {previewName} {openMenuName} {renamingName}
    bind:renameDraft {confirmDeleteName}
    onToggleSelect={onToggleSelect} onActivate={onActivate} onPreview={onPreview}
    onToggleMenu={onToggleMenu} onCloseMenu={onCloseMenu} onStartRename={onStartRename}
    onSubmitRename={onSubmitRename} onCancelRename={onCancelRename} onCopyPath={copy}
    onZipEntry={onZipEntry} onStartDelete={onStartDelete}
    onConfirmDelete={onConfirmDelete} onCancelDelete={onCancelDelete}
  />
{:else if mode === "list"}
  <FilesListView
    {entries} {dirPath} {busy} {variant} {uid}
    {selectedName} {selectedNames} {previewName} {openMenuName} {renamingName}
    bind:renameDraft {confirmDeleteName}
    onToggleSelect={onToggleSelect} onActivate={onActivate} onPreview={onPreview}
    onToggleMenu={onToggleMenu} onCloseMenu={onCloseMenu} onStartRename={onStartRename}
    onSubmitRename={onSubmitRename} onCancelRename={onCancelRename} onCopyPath={copy}
    onZipEntry={onZipEntry} onStartDelete={onStartDelete}
    onConfirmDelete={onConfirmDelete} onCancelDelete={onCancelDelete}
  />
{:else}
  <FilesExplorerTable
    {entries} {dirPath} {busy} {selectedName} {selectedNames} {previewName} {openMenuName}
    {renamingName} bind:renameDraft {confirmDeleteName} {sortField} {sortDir}
    onSortColumn={onSortColumn} onToggleSelect={onToggleSelect} onToggleSelectAll={onToggleSelectAll}
    onActivate={onActivate} onPreview={onPreview} onToggleMenu={onToggleMenu}
    onCloseMenu={onCloseMenu} onStartRename={onStartRename} onSubmitRename={onSubmitRename}
    onCancelRename={onCancelRename} onCopyPath={copy} onZipEntry={onZipEntry}
    onStartDelete={onStartDelete} onConfirmDelete={onConfirmDelete} onCancelDelete={onCancelDelete}
  />
{/if}
