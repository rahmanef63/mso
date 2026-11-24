import {
  ApiError, createDirectory, deleteFsEntry, listDirectory, readTextFile, writeTextFile,
  type FsEntryMeta, type FsRoot, type ShellBridge,
} from "./files-api.ts";
import {
  batchDeleteFsEntries, batchTransferFsEntries, renameFsEntry, uploadFsFiles,
  type UploadOutcome, type UploadProgressState,
} from "./files-extended-api.ts";
import { mediaKindFor, type MediaKind, type UploadItem } from "./files-meta.ts";
import { joinFsPath, validateEntryName } from "./files-path-utils.ts";

export { joinFsPath, validateEntryName };

export type FilePreviewState =
  | { kind: "idle" }
  | { kind: "loading"; path: string; name: string }
  | { kind: "ready"; path: string; name: string; content: string; mediaKind?: MediaKind; entry?: FsEntryMeta }
  | { kind: "error"; path: string; name: string; message: string };

export type FilesReadyState = {
  kind: "ready"; path: string; parent: string | null; entries: FsEntryMeta[]; roots: FsRoot[];
  preview: FilePreviewState; busy: boolean; notice: string | null; actionError: string | null;
};

export type FilesState =
  | { kind: "loading"; path: string }
  | FilesReadyState
  | { kind: "error"; path: string; message: string };

export function sortFsEntries(entries: FsEntryMeta[]): FsEntryMeta[] {
  return [...entries].sort((a, b) => (a.kind !== b.kind ? (a.kind === "dir" ? -1 : 1) : a.name.localeCompare(b.name)));
}

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

  async function saveFile(path: string, content: string): Promise<boolean> {
    return runMutation(async (signal) => {
      await writeTextFile(path, content, signal, fetcher, options.bridge);
      const curPrev = currentReady?.preview;
      const nextPreview = curPrev && curPrev.kind === "ready" && curPrev.path === path
        ? { ...curPrev, content }
        : curPrev && curPrev.kind !== "idle" && curPrev.path === path
          ? { kind: "ready" as const, path, name: curPrev.name, content }
          : undefined;
      return { notice: "File saved.", nextPreview };
    }, "Could not save file. Check the backend and retry.");
  }

  async function mkdir(name: string): Promise<boolean> {
    if (disposed || !currentReady || currentReady.busy) return false;
    const invalid = validateEntryName(name, "Folder");
    if (invalid) { emitReady({ busy: false, notice: null, actionError: invalid }); return false; }
    const trimmed = name.trim();
    return runMutation(async (signal, dirPath) => {
      await createDirectory(joinFsPath(dirPath, trimmed), signal, fetcher, options.bridge);
      return { notice: `Created folder "${trimmed}".` };
    }, "Could not create folder. Check the backend and retry.");
  }

  async function removeEntry(name: string): Promise<boolean> {
    if (disposed || !currentReady || currentReady.busy) return false;
    const invalid = validateEntryName(name, "Entry");
    if (invalid) { emitReady({ busy: false, notice: null, actionError: invalid }); return false; }
    const trimmed = name.trim();
    return runMutation(async (signal, dirPath) => {
      const targetPath = joinFsPath(dirPath, trimmed);
      await deleteFsEntry(targetPath, signal, fetcher, options.bridge);
      let nextPreview: FilePreviewState | undefined;
      if (currentReady && currentReady.preview.kind !== "idle"
          && (currentReady.preview.path === targetPath || currentReady.preview.path.startsWith(`${targetPath}/`))) {
        previewGen++;
        previewAbort?.abort();
        nextPreview = { kind: "idle" };
      }
      return { notice: `Deleted "${trimmed}".`, nextPreview };
    }, "Could not delete entry. Check the backend and retry.");
  }

  async function renameEntry(fromName: string, toName: string): Promise<boolean> {
    if (disposed || !currentReady || currentReady.busy) return false;
    const invalid = validateEntryName(toName, "New name");
    if (invalid) { emitReady({ busy: false, notice: null, actionError: invalid }); return false; }
    const cleanTo = toName.trim();
    if (fromName.trim() === cleanTo) {
      emitReady({ busy: false, notice: null, actionError: "New name must differ from the current name." });
      return false;
    }
    return runMutation(async (signal, dirPath) => {
      await renameFsEntry(dirPath, fromName, cleanTo, signal, fetcher, options.bridge);
      const oldPath = joinFsPath(dirPath, fromName.trim());
      const newPath = joinFsPath(dirPath, cleanTo);
      const curPrev = currentReady?.preview;
      const nextPreview = curPrev && curPrev.kind === "ready" && curPrev.path === oldPath
        ? { ...curPrev, path: newPath, name: cleanTo, mediaKind: mediaKindFor(cleanTo) }
        : undefined;
      return { notice: `Renamed "${fromName.trim()}" to "${cleanTo}".`, nextPreview };
    }, "Could not rename entry. Check the backend and retry.");
  }

  async function uploadFiles(
    items: readonly UploadItem[],
    onProgress?: (progress: UploadProgressState) => void,
  ): Promise<UploadOutcome | null> {
    let outcome: UploadOutcome | null = null;
    const ok = await runMutation(async (signal, dirPath) => {
      outcome = await uploadFsFiles(dirPath, items, signal, {
        onProgress,
        fetcher: options.fetcher,
        bridge: options.bridge,
      });
      const failedCount = outcome.failed.length;
      const notice = outcome.written > 0
        ? `Uploaded ${outcome.written} ${outcome.written === 1 ? "file" : "files"}.`
        : "";
      const actionError = failedCount > 0
        ? `${failedCount} ${failedCount === 1 ? "file" : "files"} failed: ${outcome.failed.slice(0, 3).join(", ")}`
        : null;
      return { notice, actionError };
    }, "Could not upload files. Check the backend and retry.");
    return ok ? outcome : null;
  }

  async function batchDelete(names: readonly string[]): Promise<boolean> {
    if (!names.length) return false;
    return runMutation(async (signal, dirPath) => {
      const res = await batchDeleteFsEntries(dirPath, names, signal, fetcher, options.bridge);
      let nextPreview: FilePreviewState | undefined;
      if (currentReady && currentReady.preview.kind !== "idle") {
        const previewPath = currentReady.preview.path;
        if (res.deleted.some((n) => {
          const p = joinFsPath(dirPath, n);
          return previewPath === p || previewPath.startsWith(`${p}/`);
        })) {
          previewGen++;
          previewAbort?.abort();
          nextPreview = { kind: "idle" };
        }
      }
      const notice = res.deleted.length
        ? `Deleted ${res.deleted.length} ${res.deleted.length === 1 ? "item" : "items"}.`
        : "";
      const actionError = res.failed.length ? `Could not delete: ${res.failed.join(", ")}` : null;
      return { notice, actionError, nextPreview };
    }, "Could not delete selected items. Check the backend and retry.");
  }

  async function batchTransfer(mode: "copy" | "move", names: readonly string[], destDir: string): Promise<boolean> {
    if (!names.length) return false;
    return runMutation(async (signal, dirPath) => {
      const res = await batchTransferFsEntries(mode, dirPath, names, destDir, signal, fetcher, options.bridge);
      const verb = mode === "copy" ? "Copied" : "Moved";
      const notice = res.transferred.length
        ? `${verb} ${res.transferred.length} ${res.transferred.length === 1 ? "item" : "items"} to "${destDir.trim()}".`
        : "";
      const actionError = res.failed.length ? `Could not ${mode}: ${res.failed.join(", ")}` : null;
      return { notice, actionError };
    }, `Could not ${mode} selected items. Check the backend and retry.`);
  }

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
