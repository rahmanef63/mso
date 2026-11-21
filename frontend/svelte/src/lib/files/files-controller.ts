import {
  ApiError, createDirectory, deleteFsEntry, listDirectory, readTextFile, writeTextFile,
  type FsEntry, type FsRoot, type ShellBridge,
} from "./files-api.ts";

export type FilePreviewState =
  | { kind: "idle" }
  | { kind: "loading"; path: string; name: string }
  | { kind: "ready"; path: string; name: string; content: string }
  | { kind: "error"; path: string; name: string; message: string };

export type FilesReadyState = {
  kind: "ready"; path: string; parent: string | null; entries: FsEntry[]; roots: FsRoot[];
  preview: FilePreviewState; busy: boolean; notice: string | null; actionError: string | null;
};

export type FilesState =
  | { kind: "loading"; path: string }
  | FilesReadyState
  | { kind: "error"; path: string; message: string };

export function joinFsPath(dir: string, name: string): string {
  if (!dir || dir === "/") return `/${name}`;
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

export function sortFsEntries(entries: FsEntry[]): FsEntry[] {
  return [...entries].sort((a, b) => (a.kind !== b.kind ? (a.kind === "dir" ? -1 : 1) : a.name.localeCompare(b.name)));
}

export function validateEntryName(raw: string, label = "Folder"): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return `${label} name is required.`;
  if (trimmed === "." || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
    return `${label} name must be a single segment without slashes or "..".`;
  }
  return null;
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
    const controller = dirAbort = new AbortController();
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

  async function openFile(entry: Pick<FsEntry, "name"> | string) {
    if (disposed || !currentReady) return;
    const name = typeof entry === "string" ? (entry.split("/").filter(Boolean).pop() ?? entry) : entry.name;
    const path = typeof entry === "string" ? entry : joinFsPath(currentReady.path, entry.name);
    const run = ++previewGen, boundDir = dirGen;
    previewAbort?.abort();
    const controller = previewAbort = new AbortController();
    emitReady({ preview: { kind: "loading", path, name }, notice: null, actionError: null });
    try {
      const content = await readTextFile(path, controller.signal, fetcher, options.bridge);
      if (disposed || run !== previewGen || boundDir !== dirGen) return;
      emitReady({ preview: { kind: "ready", path, name, content } });
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
    work: (signal: AbortSignal, dirPath: string) => Promise<{ notice: string; nextPreview?: FilePreviewState }>,
    fallbackError: string,
  ): Promise<boolean> {
    if (disposed || !currentReady || currentReady.busy) return false;
    const dirPath = currentReady.path, boundDir = dirGen, run = ++mutGen;
    mutAbort?.abort();
    const controller = mutAbort = new AbortController();
    emitReady({ busy: true, notice: null, actionError: null });
    try {
      const outcome = await work(controller.signal, dirPath);
      if (disposed || run !== mutGen || boundDir !== dirGen || !currentReady) return false;
      const patch: Partial<FilesReadyState> = { busy: false, notice: outcome.notice, actionError: null };
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
      const nextPreview = currentReady?.preview.kind !== "idle" && currentReady?.preview.path === path
        ? { kind: "ready" as const, path, name: currentReady.preview.name, content }
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

  return {
    openDir, openFile, closePreview, saveFile, mkdir, removeEntry,
    goParent: () => (currentReady?.parent ? openDir(currentReady.parent) : Promise.resolve()),
    refresh: () => openDir(currentPath),
    clearFeedback: () => { if (!disposed && currentReady) emitReady({ notice: null, actionError: null }); },
    dispose() {
      disposed = true; dirGen++; previewGen++; mutGen++;
      dirAbort?.abort(); previewAbort?.abort(); mutAbort?.abort();
    },
  };
}
