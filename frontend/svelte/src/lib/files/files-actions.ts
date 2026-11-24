import { tick } from "svelte";
import type { FsEntryMeta } from "./files-api.ts";
import type { FilesState } from "./files-controller.ts";
import type { createFilesController } from "./files-controller.ts";

type FilesController = ReturnType<typeof createFilesController>;
import { fetchFsUsage, type FsUsageInfo, type UploadProgressState } from "./files-extended-api.ts";
import { readDropEntries, type SortDir, type SortField, type UploadItem } from "./files-meta.ts";
import { joinFsPath } from "./files-path-utils.ts";
import type { FilesViewMode } from "./FilesChromeHeader.svelte";

export type FilesActionsDeps = {
  readonly view: FilesState;
  selectedNames: ReadonlySet<string>;
  selectedName: string | null;
  readonly filteredEntries: readonly FsEntryMeta[];
  creatingFolder: boolean;
  newFolderName: string;
  renamingName: string | null;
  renameDraft: string;
  confirmDeleteName: string | null;
  editing: boolean;
  editPath: string | null;
  draft: string;
  uploading: boolean;
  uploadCount: number;
  uploadProgress: UploadProgressState | null;
  dragActive: boolean;
  diskUsage: FsUsageInfo | null;
  usageLoading: boolean;
  openMenuName: string | null;
  sidebarOpen: boolean;
  sortField: SortField;
  sortDir: SortDir;
  readonly newFolderInput: HTMLInputElement | undefined;
  readonly editorEl: HTMLTextAreaElement | undefined;
  readonly controller: FilesController | undefined;
  readonly winId: string | undefined;
  navigateHref: (winId: string | undefined, key: string, value: unknown) => void;
};

export function createFilesActions(deps: FilesActionsDeps) {
  let usageAbort: AbortController | undefined;

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

  function toggleQuickLook(): void {
    const view = deps.view;
    if (view.kind !== "ready") return;
    if (view.preview.kind !== "idle") { closePreview(); return; }
    const pick = deps.filteredEntries.find(
      (e) => e.kind === "file" && (e.name === deps.selectedName || deps.selectedNames.has(e.name)),
    ) ?? deps.filteredEntries.find((e) => e.kind === "file");
    if (pick) void deps.controller?.openFile(pick);
    else deps.controller?.setNotice("No files to preview in this folder.");
  }

  async function loadUsage(targetPath?: string): Promise<void> {
    usageAbort?.abort();
    const ctrl = (usageAbort = new AbortController());
    deps.usageLoading = true;
    try {
      const info = await fetchFsUsage(targetPath, ctrl.signal);
      if (!ctrl.signal.aborted) deps.diskUsage = info;
    } catch {
      // keep the previous or idle usage value
    } finally {
      if (!ctrl.signal.aborted) deps.usageLoading = false;
    }
  }

  async function handleUpload(items: UploadItem[]): Promise<void> {
    if (!items.length || deps.uploading) return;
    deps.uploading = true;
    deps.uploadCount = items.length;
    deps.uploadProgress = { loaded: 0, total: 0, pct: 0 };
    try {
      const res = await deps.controller?.uploadFiles(items, (p: UploadProgressState) => { deps.uploadProgress = p; });
      const view = deps.view;
      if (res && view.kind === "ready" && view.roots.length > 0) void loadUsage(view.path);
    } finally {
      deps.uploading = false;
      deps.uploadProgress = null;
    }
  }

  function handleDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes("Files")) {
      event.preventDefault();
      deps.dragActive = true;
    }
  }

  function handleDragLeave(event: DragEvent): void {
    if (event.currentTarget === event.target) deps.dragActive = false;
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    deps.dragActive = false;
    if (event.dataTransfer) {
      void readDropEntries(event.dataTransfer).then((items) => {
        if (items.length) void handleUpload(items);
      });
    }
  }

  async function copyPathText(targetPath: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(targetPath);
      deps.controller?.setNotice(`Copied path "${targetPath}".`);
    } catch {
      deps.controller?.setNotice(`Path: ${targetPath}`);
    }
  }

  async function toggleNewFolder(): Promise<void> {
    if (deps.creatingFolder) {
      deps.creatingFolder = false;
      deps.newFolderName = "";
      return;
    }
    deps.controller?.clearFeedback();
    deps.creatingFolder = true;
    deps.newFolderName = "";
    await tick();
    deps.newFolderInput?.focus();
  }

  async function submitNewFolder(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (await deps.controller?.mkdir(deps.newFolderName)) {
      deps.creatingFolder = false;
      deps.newFolderName = "";
    } else {
      await tick();
      deps.newFolderInput?.focus();
    }
  }

  function startRename(name: string): void {
    deps.controller?.clearFeedback();
    deps.renamingName = name;
    deps.renameDraft = name;
    deps.confirmDeleteName = null;
  }

  async function submitRename(fromName: string): Promise<void> {
    if (await deps.controller?.renameEntry(fromName, deps.renameDraft)) deps.renamingName = null;
  }

  async function startEdit(path: string, content: string): Promise<void> {
    deps.controller?.clearFeedback();
    deps.editing = true;
    deps.editPath = path;
    deps.draft = content;
    await tick();
    deps.editorEl?.focus();
  }

  async function saveEdit(path: string): Promise<void> {
    if (await deps.controller?.saveFile(path, deps.draft)) {
      deps.editing = false;
      deps.editPath = null;
    }
  }

  function startDelete(name: string): void {
    deps.controller?.clearFeedback();
    deps.confirmDeleteName = name;
    deps.renamingName = null;
  }

  async function confirmDelete(name: string): Promise<void> {
    if (await deps.controller?.removeEntry(name)) {
      const next = new Set(deps.selectedNames);
      next.delete(name);
      deps.selectedNames = next;
    }
    deps.confirmDeleteName = null;
  }

  async function handleBatchDelete(): Promise<void> {
    if (await deps.controller?.batchDelete([...deps.selectedNames])) deps.selectedNames = new Set();
  }

  async function handleBatchTransfer(mode: "copy" | "move", dest: string): Promise<void> {
    if (await deps.controller?.batchTransfer(mode, [...deps.selectedNames], dest) && mode === "move") {
      deps.selectedNames = new Set();
    }
  }

  return {
    setMode, closePreview, navigateTo, handleOpenResult, toggleSelect, toggleSelectAll,
    handleSortColumn, handleActivateEntry, toggleQuickLook, loadUsage, handleUpload,
    handleDragOver, handleDragLeave, handleDrop, copyPathText, toggleNewFolder,
    submitNewFolder, startRename, submitRename, startEdit, saveEdit, startDelete,
    confirmDelete, handleBatchDelete, handleBatchTransfer,
  };
}
