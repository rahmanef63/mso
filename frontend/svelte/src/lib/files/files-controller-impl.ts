import {
  ApiError, createDirectory, deleteFsEntry, listDirectory, readTextFile, writeTextFile,
  type FsEntryMeta, type FsRoot, type ShellBridge,
} from "./files-api.ts";
import {
  batchDeleteFsEntries, batchTransferFsEntries, renameFsEntry, uploadFsFiles,
  type UploadOutcome, type UploadProgressState,
} from "./files-extended-api.ts";
import { mediaKindFor, type MediaKind, type UploadItem } from "./files-meta.ts";
import { createMutationOps } from "./files-mutation-ops.ts";
import { joinFsPath } from "./files-path-utils.ts";
import type { FilePreviewState, FilesReadyState, FilesState } from "./files-controller-types.ts";
import { sortFsEntries } from "./files-controller-types.ts";

export function createFilesController(
  update: (state: FilesState) => void,
  options: { fetcher?: typeof fetch; bridge?: ShellBridge; initialPath?: string } = {},
) {
  const fetcher = options.fetcher ?? fetch;
  let dirGen = 0, previewGen = 0, mutGen = 0, disposed = false;
  let dirAbort: AbortController | undefined;
  let previewAbort: AbortController | undefined;
  let mutAbort: AbortController | undefined;
  let currentPath = options.initialPath ?? "~";
  let currentReady: FilesReadyState | null = null;

  function emitReady(patch: Partial<FilesReadyState>) {
    if (!currentReady) return;
    currentReady = { ...currentReady, ...patch };
    update(currentReady);
  }

  async function openDir(path = currentPath) {
    if (disposed) return;
    const target = path || "~";
    currentPath = target;
    const run = ++dirGen;
    previewGen++;
    mutGen++;
    dirAbort?.abort();
    previewAbort?.abort();
    mutAbort?.abort();
    const controller = (dirAbort = new AbortController());
    currentReady = null;
    update({ kind: "loading", path: target });
    try {
      const listing = await listDirectory(target, controller.signal, fetcher, options.bridge);
      if (disposed || run !== dirGen) return;
      currentPath = listing.path;
      currentReady = {
        kind: "ready", path: listing.path, parent: listing.parent ?? null,
        entries: sortFsEntries(listing.entries), roots: listing.roots ?? [],
        preview: { kind: "idle" }, busy: false, notice: null, actionError: null,
      };
      update(currentReady);
    } catch (error) {
      if (disposed || run !== dirGen || controller.signal.aborted) return;
      const message = error instanceof ApiError ? error.message : "Could not load directory. Check the backend and retry.";
      update({ kind: "error", path: target, message });
    }
  }

  async function openFile(entry: Pick<FsEntryMeta, "name"> & Partial<FsEntryMeta> | string) {
    if (disposed || !currentReady) return;
    const name = typeof entry === "string" ? (entry.split("/").filter(Boolean).pop() ?? entry) : entry.name;
    const path = typeof entry === "string" ? entry : joinFsPath(currentReady.path, entry.name);
    const meta = typeof entry === "string"
      ? currentReady.entries.find((item) => item.name === name)
      : (currentReady.entries.find((item) => item.name === entry.name)
        ?? { name: entry.name, kind: entry.kind ?? "file", size: entry.size ?? 0, ext: entry.ext, mime: entry.mime, mtime: entry.mtime });
    const mediaKind = mediaKindFor(meta ?? name);
    const run = ++previewGen, boundDir = dirGen;
    previewAbort?.abort();

    if (mediaKind === "image" || mediaKind === "audio" || mediaKind === "video" || mediaKind === "binary") {
      emitReady({
        preview: { kind: "ready", path, name, content: "", mediaKind, entry: meta },
        notice: null,
        actionError: null,
      });
      return;
    }

    const controller = (previewAbort = new AbortController());
    emitReady({ preview: { kind: "loading", path, name }, notice: null, actionError: null });
    try {
      const content = await readTextFile(path, controller.signal, fetcher, options.bridge);
      if (disposed || run !== previewGen || boundDir !== dirGen) return;
      emitReady({ preview: { kind: "ready", path, name, content, mediaKind, entry: meta } });
    } catch (error) {
      if (disposed || run !== previewGen || boundDir !== dirGen || controller.signal.aborted) return;
      const message = error instanceof ApiError ? error.message : "Could not read file. Check the backend and retry.";
      emitReady({ preview: { kind: "error", path, name, message } });
    }
  }

  function closePreview() {
    if (disposed) return;
    previewGen++;
    previewAbort?.abort();
    if (currentReady && currentReady.preview.kind !== "idle") emitReady({ preview: { kind: "idle" } });
  }

  async function runMutation(
    work: (signal: AbortSignal, dirPath: string) => Promise<{ notice: string; actionError?: string | null; nextPreview?: FilePreviewState }>,
    fallbackError: string,
  ): Promise<boolean> {
    if (disposed || !currentReady || currentReady.busy) return false;
    const dirPath = currentReady.path, boundDir = dirGen, run = ++mutGen;
    mutAbort?.abort();
    const controller = (mutAbort = new AbortController());
    emitReady({ busy: true, notice: null, actionError: null });
    try {
      const outcome = await work(controller.signal, dirPath);
      if (disposed || run !== mutGen || boundDir !== dirGen || !currentReady) return false;
      const patch: Partial<FilesReadyState> = {
        busy: false,
        notice: outcome.notice,
        actionError: outcome.actionError ?? null,
      };
      if (outcome.nextPreview !== undefined) patch.preview = outcome.nextPreview;
      try {
        const listing = await listDirectory(dirPath, controller.signal, fetcher, options.bridge);
        if (disposed || run !== mutGen || boundDir !== dirGen || !currentReady) return false;
        patch.entries = sortFsEntries(listing.entries);
        patch.parent = listing.parent ?? null;
        patch.roots = listing.roots ?? [];
      } catch (refreshErr) {
        if (disposed || run !== mutGen || boundDir !== dirGen || controller.signal.aborted) return false;
        patch.actionError = refreshErr instanceof ApiError ? refreshErr.message : "Action completed, but directory refresh failed.";
      }
      emitReady(patch);
      return true;
    } catch (error) {
      if (disposed || run !== mutGen || boundDir !== dirGen || controller.signal.aborted) return false;
      emitReady({ busy: false, notice: null, actionError: error instanceof ApiError ? error.message : fallbackError });
      return false;
    }
  }

  const mkOps = createMutationOps({
    get currentReady() { return currentReady; },
    fetcher,
    bridge: options.bridge,
    runMutation,
    disposed: () => disposed,
    emitReady,
    invalidatePreview: () => { previewGen++; previewAbort?.abort(); },
  });

  async function uploadFiles(
    items: readonly UploadItem[],
    onProgress?: (progress: UploadProgressState) => void,
  ): Promise<UploadOutcome | null> {
    let outcome: UploadOutcome | null = null;
    const ok = await runMutation(async (signal, dirPath) => {
      outcome = await uploadFsFiles(dirPath, items, signal, { onProgress, fetcher, bridge: options.bridge });
      const failedCount = outcome.failed.length;
      const notice = outcome.written > 0 ? `Uploaded ${outcome.written} ${outcome.written === 1 ? "file" : "files"}.` : "";
      const actionError = failedCount > 0
        ? `${failedCount} ${failedCount === 1 ? "file" : "files"} failed: ${outcome.failed.slice(0, 3).join(", ")}`
        : null;
      return { notice, actionError };
    }, "Could not upload files. Check the backend and retry.");
    return ok ? outcome : null;
  }

  const { saveFile, mkdir, removeEntry, renameEntry, batchDelete, batchTransfer } = mkOps;

  return {
    openDir, openFile, closePreview, saveFile, mkdir, removeEntry,
    renameEntry, uploadFiles, batchDelete, batchTransfer,
    goParent: () => (currentReady?.parent ? openDir(currentReady.parent) : Promise.resolve()),
    refresh: () => openDir(currentPath),
    setNotice: (notice: string) => { if (!disposed && currentReady) emitReady({ notice, actionError: null }); },
    clearFeedback: () => { if (!disposed && currentReady) emitReady({ notice: null, actionError: null }); },
    dispose() {
      disposed = true; dirGen++; previewGen++; mutGen++;
      dirAbort?.abort(); previewAbort?.abort(); mutAbort?.abort();
    },
  };
}
