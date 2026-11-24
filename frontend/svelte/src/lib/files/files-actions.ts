import { tick } from "svelte";
import type { FsEntryMeta } from "./files-api.ts";
import type { FilesState } from "./files-controller.ts";
import type { createFilesController } from "./files-controller.ts";

type FilesController = ReturnType<typeof createFilesController>;
import { fetchFsUsage, type FsUsageInfo, type UploadProgressState } from "./files-extended-api.ts";
import { readDropEntries, type SortDir, type SortField, type UploadItem } from "./files-meta.ts";
import { joinFsPath } from "./files-path-utils.ts";
import { createSelectActions } from "./files-select-actions.ts";

export type { FilesActionsDeps } from "./files-actions-types.ts";
import type { FilesActionsDeps } from "./files-actions-types.ts";

export function createFilesActions(deps: FilesActionsDeps) {
  const { setMode, closePreview, navigateTo, handleOpenResult, toggleSelect, toggleSelectAll, handleSortColumn, handleActivateEntry } = createSelectActions(deps);

  let usageAbort: AbortController | undefined;

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
