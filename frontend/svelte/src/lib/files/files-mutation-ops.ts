import {
  createDirectory, deleteFsEntry, listDirectory, writeTextFile,
} from "./files-api.ts";
import {
  batchDeleteFsEntries, batchTransferFsEntries, renameFsEntry, uploadFsFiles,
} from "./files-extended-api.ts";
import { joinFsPath, validateEntryName } from "./files-path-utils.ts";
import { mediaKindFor } from "./files-meta.ts";
import type { FilePreviewState, FilesReadyState } from "./files-controller-types.ts";
import { sortFsEntries } from "./files-controller-types.ts";
import type { UploadItem } from "./files-meta.ts";

export type MutationContext = {
  readonly currentReady: FilesReadyState | null;
  readonly disposed: () => boolean;
  readonly emitReady: (patch: Partial<FilesReadyState>) => void;
  readonly invalidatePreview: () => void;
  readonly fetcher: typeof fetch;
  readonly bridge: unknown;
  readonly runMutation: (
    work: (signal: AbortSignal, dirPath: string) => Promise<{ notice: string; actionError?: string | null; nextPreview?: FilePreviewState }>,
    fallbackError: string,
  ) => Promise<boolean>;
};

export function createMutationOps(ctx: MutationContext) {
  const runMutation = ctx.runMutation;
  const fetcher = ctx.fetcher;
  const options = { fetcher: ctx.fetcher, bridge: ctx.bridge as never };

async function saveFile(path: string, content: string): Promise<boolean> {
  return runMutation(async (signal) => {
    await writeTextFile(path, content, signal, fetcher, options.bridge);
    const curPrev = ctx.currentReady?.preview;
    const nextPreview = curPrev && curPrev.kind === "ready" && curPrev.path === path
      ? { ...curPrev, content }
      : curPrev && curPrev.kind !== "idle" && curPrev.path === path
        ? { kind: "ready" as const, path, name: curPrev.name, content }
        : undefined;
    return { notice: "File saved.", nextPreview };
  }, "Could not save file. Check the backend and retry.");
}

async function mkdir(name: string): Promise<boolean> {
  if (ctx.disposed() || !ctx.currentReady || ctx.currentReady.busy) return false;
  const invalid = validateEntryName(name, "Folder");
  if (invalid) { ctx.emitReady({ busy: false, notice: null, actionError: invalid }); return false; }
  const trimmed = name.trim();
  return runMutation(async (signal, dirPath) => {
    await createDirectory(joinFsPath(dirPath, trimmed), signal, fetcher, options.bridge);
    return { notice: `Created folder "${trimmed}".` };
  }, "Could not create folder. Check the backend and retry.");
}

async function removeEntry(name: string): Promise<boolean> {
  if (ctx.disposed() || !ctx.currentReady || ctx.currentReady.busy) return false;
  const invalid = validateEntryName(name, "Entry");
  if (invalid) { ctx.emitReady({ busy: false, notice: null, actionError: invalid }); return false; }
  const trimmed = name.trim();
  return runMutation(async (signal, dirPath) => {
    const targetPath = joinFsPath(dirPath, trimmed);
    await deleteFsEntry(targetPath, signal, fetcher, options.bridge);
    let nextPreview: FilePreviewState | undefined;
    if (ctx.currentReady && ctx.currentReady.preview.kind !== "idle"
        && (ctx.currentReady.preview.path === targetPath || ctx.currentReady.preview.path.startsWith(`${targetPath}/`))) {
      ctx.invalidatePreview();
      nextPreview = { kind: "idle" };
    }
    return { notice: `Deleted "${trimmed}".`, nextPreview };
  }, "Could not delete entry. Check the backend and retry.");
}

async function renameEntry(fromName: string, toName: string): Promise<boolean> {
  if (ctx.disposed() || !ctx.currentReady || ctx.currentReady.busy) return false;
  const invalid = validateEntryName(toName, "New name");
  if (invalid) { ctx.emitReady({ busy: false, notice: null, actionError: invalid }); return false; }
  const cleanTo = toName.trim();
  if (fromName.trim() === cleanTo) {
    ctx.emitReady({ busy: false, notice: null, actionError: "New name must differ from the current name." });
    return false;
  }
  return runMutation(async (signal, dirPath) => {
    await renameFsEntry(dirPath, fromName, cleanTo, signal, fetcher, options.bridge);
    const oldPath = joinFsPath(dirPath, fromName.trim());
    const newPath = joinFsPath(dirPath, cleanTo);
    const curPrev = ctx.currentReady?.preview;
    const nextPreview = curPrev && curPrev.kind === "ready" && curPrev.path === oldPath
      ? { ...curPrev, path: newPath, name: cleanTo, mediaKind: mediaKindFor(cleanTo) }
      : undefined;
    return { notice: `Renamed "${fromName.trim()}" to "${cleanTo}".`, nextPreview };
  }, "Could not rename entry. Check the backend and retry.");
}

async function batchDelete(names: readonly string[]): Promise<boolean> {
  if (!names.length) return false;
  return runMutation(async (signal, dirPath) => {
    const res = await batchDeleteFsEntries(dirPath, names, signal, fetcher, options.bridge);
    let nextPreview: FilePreviewState | undefined;
    if (ctx.currentReady && ctx.currentReady.preview.kind !== "idle") {
      const previewPath = ctx.currentReady.preview.path;
      if (res.deleted.some((n) => {
        const p = joinFsPath(dirPath, n);
        return previewPath === p || previewPath.startsWith(`${p}/`);
      })) {
        ctx.invalidatePreview();
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

  return { saveFile, mkdir, removeEntry, renameEntry, batchDelete, batchTransfer };
}
