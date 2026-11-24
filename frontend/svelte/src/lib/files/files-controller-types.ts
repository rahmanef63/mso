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
