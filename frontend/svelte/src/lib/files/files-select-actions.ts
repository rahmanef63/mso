import type { FsEntryMeta } from "./files-api.ts";
import type { SortDir, SortField } from "./files-meta.ts";
import { joinFsPath } from "./files-path-utils.ts";
import type { FilesActionsDeps } from "./files-actions-types.ts";
import type { FilesViewMode } from "./FilesChromeHeader.svelte";

// The third mode is presented as "Details" but keeps the legacy persisted value
// "columns". Normalising on read means an old saved window state still resolves to
// a real view instead of falling through to an empty one.
const VIEW_MODES: readonly FilesViewMode[] = ["list", "grid", "columns"];

export function normalizeViewMode(raw: unknown): FilesViewMode {
  return VIEW_MODES.includes(raw as FilesViewMode) ? (raw as FilesViewMode) : "list";
}

/** Presentation label for a stored mode. Kept next to normalizeViewMode so the
 *  "columns" -> "Details" rename cannot drift from its persisted key. */
export function viewModeLabel(mode: FilesViewMode): "Icons" | "List" | "Details" {
  return mode === "grid" ? "Icons" : mode === "columns" ? "Details" : "List";
}

export function createSelectActions(deps: FilesActionsDeps) {function setMode(next: FilesViewMode): void {
  // Persist for the next mount and update the live state: the reactive view mode is
  // read only once at mount, so persisting alone leaves the toolbar aria-pressed
  // and the rendered grid stale until the window is reopened.
  const mode = normalizeViewMode(next);
  deps.navigateHref(deps.winId, "files.viewMode", mode);
  deps.viewMode = mode;
}

function closePreview(): void {
  deps.editing = false;
  deps.editPath = null;
  deps.controller?.closePreview();
}

function navigateTo(nextPath: string): void {
  deps.sidebarOpen = false;
  deps.openMenuName = null;
  // A different folder has a different set of rows, so the old selection cannot
  // stay actionable: clear it before the new listing lands.
  deps.selectedNames = new Set();
  deps.selectedName = null;
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
  // Keep the single-selection cursor in step with the set: a removed name must not
  // linger as "selected" in row styling or preview targeting.
  deps.selectedName = next.has(name) ? name : [...next][0] ?? null;
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
