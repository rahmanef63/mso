import type { FsEntryMeta } from "./files-api.ts";
import type { SortDir, SortField } from "./files-meta.ts";
import { joinFsPath } from "./files-path-utils.ts";
import type { FilesActionsDeps } from "./files-actions-types.ts";
import type { FilesViewMode } from "./FilesChromeHeader.svelte";

export function createSelectActions(deps: FilesActionsDeps) {
function setMode(next: FilesViewMode): void {
  deps.navigateHref(deps.winId, "files.viewMode", next);
}

function closePreview(): void {
  deps.editing = false;
  deps.editPath = null;
  deps.controller?.closePreview();
}

function navigateTo(nextPath: string): void {
  deps.sidebarOpen = false;
  deps.openMenuName = null;
  deps.navigateHref(deps.winId, "files.path", nextPath);
  void deps.controller?.openDir(nextPath);
}

function handleOpenResult(path: string, kind?: "dir" | "file"): void {
  if (kind === "dir") navigateTo(path);
  else void deps.controller?.openFile(path);
}

function toggleSelect(name: string): void {
  const next = new Set(deps.selectedNames);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  deps.selectedNames = next;
  deps.selectedName = next.size === 1 ? [...next][0] ?? null : name;
}

function toggleSelectAll(): void {
  deps.selectedNames = deps.selectedNames.size === deps.filteredEntries.length && deps.filteredEntries.length > 0
    ? new Set() : new Set(deps.filteredEntries.map((e) => e.name));
}

function handleSortColumn(field: SortField): void {
  if (deps.sortField === field) deps.sortDir = deps.sortDir === "asc" ? "desc" : "asc";
  else { deps.sortField = field; deps.sortDir = "asc"; }
}

function handleActivateEntry(entry: FsEntryMeta, event?: MouseEvent): void {
  if (event && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    toggleSelect(entry.name);
    return;
  }
  deps.selectedName = entry.name;
  deps.openMenuName = null;
  const view = deps.view;
  if (view.kind !== "ready") return;
  if (entry.kind === "dir") navigateTo(joinFsPath(view.path, entry.name));
  else void deps.controller?.openFile(entry);
}

  return {
    setMode, closePreview, navigateTo, handleOpenResult, toggleSelect,
    toggleSelectAll, handleSortColumn, handleActivateEntry,
  };
}
