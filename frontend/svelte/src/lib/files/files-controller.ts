import { ApiError, listDirectory, readTextFile, type FsEntry, type FsRoot, type ShellBridge } from "./files-api.ts";

export type FilePreviewState =
  | { kind: "idle" }
  | { kind: "loading"; path: string; name: string }
  | { kind: "ready"; path: string; name: string; content: string }
  | { kind: "error"; path: string; name: string; message: string };

export type FilesState =
  | { kind: "loading"; path: string }
  | { kind: "ready"; path: string; parent: string | null; entries: FsEntry[]; roots: FsRoot[]; preview: FilePreviewState }
  | { kind: "error"; path: string; message: string };

export function joinFsPath(dir: string, name: string): string {
  if (!dir || dir === "/") return `/${name}`;
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

export function sortFsEntries(entries: FsEntry[]): FsEntry[] {
  return [...entries].sort((a, b) => (a.kind !== b.kind ? (a.kind === "dir" ? -1 : 1) : a.name.localeCompare(b.name)));
}

export function createFilesController(
  update: (state: FilesState) => void,
  options: { fetcher?: typeof fetch; bridge?: ShellBridge; initialPath?: string } = {},
) {
  const fetcher = options.fetcher ?? fetch;
  let dirGen = 0, previewGen = 0, disposed = false;
  let dirAbort: AbortController | undefined;
  let previewAbort: AbortController | undefined;
  let currentPath = options.initialPath ?? "~";
  let currentReady: Extract<FilesState, { kind: "ready" }> | null = null;

  function emitReady(preview: FilePreviewState) {
    if (!currentReady) return;
    currentReady = { ...currentReady, preview };
    update(currentReady);
  }

  async function openDir(path = currentPath) {
    if (disposed) return;
    const target = path || "~";
    currentPath = target;
    const run = ++dirGen;
    previewGen++;
    dirAbort?.abort();
    previewAbort?.abort();
    const controller = dirAbort = new AbortController();
    currentReady = null;
    update({ kind: "loading", path: target });
    try {
      const listing = await listDirectory(target, controller.signal, fetcher, options.bridge);
      if (disposed || run !== dirGen) return;
      currentPath = listing.path;
      currentReady = {
        kind: "ready", path: listing.path, parent: listing.parent ?? null,
        entries: sortFsEntries(listing.entries), roots: listing.roots ?? [], preview: { kind: "idle" },
      };
      update(currentReady);
    } catch (error) {
      if (disposed || run !== dirGen || controller.signal.aborted) return;
      update({
        kind: "error", path: target,
        message: error instanceof ApiError ? error.message : "Could not load directory. Check the backend and retry.",
      });
    }
  }

  async function openFile(entry: Pick<FsEntry, "name"> | string) {
    if (disposed || !currentReady) return;
    const name = typeof entry === "string" ? (entry.split("/").filter(Boolean).pop() ?? entry) : entry.name;
    const path = typeof entry === "string" ? entry : joinFsPath(currentReady.path, entry.name);
    const run = ++previewGen;
    const boundDir = dirGen;
    previewAbort?.abort();
    const controller = previewAbort = new AbortController();
    emitReady({ kind: "loading", path, name });
    try {
      const content = await readTextFile(path, controller.signal, fetcher, options.bridge);
      if (disposed || run !== previewGen || boundDir !== dirGen) return;
      emitReady({ kind: "ready", path, name, content });
    } catch (error) {
      if (disposed || run !== previewGen || boundDir !== dirGen || controller.signal.aborted) return;
      emitReady({
        kind: "error", path, name,
        message: error instanceof ApiError ? error.message : "Could not read file. Check the backend and retry.",
      });
    }
  }

  function closePreview() {
    if (disposed) return;
    previewGen++;
    previewAbort?.abort();
    if (currentReady && currentReady.preview.kind !== "idle") emitReady({ kind: "idle" });
  }

  return {
    openDir,
    goParent: () => (currentReady?.parent ? openDir(currentReady.parent) : Promise.resolve()),
    refresh: () => openDir(currentPath),
    openFile,
    closePreview,
    dispose() { disposed = true; dirGen++; previewGen++; dirAbort?.abort(); previewAbort?.abort(); },
  };
}
