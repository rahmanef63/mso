import type { FsEntryMeta } from "./files-api.ts";
import type { MediaKind, SortDir, SortField, SortSpec } from "./files-types.ts";
import {
  ARCHIVE_EXTS, AUDIO_EXTS, BINARY_EXTS, CODE_EXTS, IMAGE_EXTS, MD_EXTS, VIDEO_EXTS,
} from "./files-ext-sets.ts";

export function entryExt(entry: Pick<FsEntryMeta, "name" | "ext">): string {
  if (entry.ext) return entry.ext.replace(/^\./, "").toLowerCase();
  const dot = entry.name.lastIndexOf(".");
  return dot > 0 && dot < entry.name.length - 1 ? entry.name.slice(dot + 1).toLowerCase() : "";
}

export function mediaKindFor(entry: Pick<FsEntryMeta, "name" | "ext" | "mime"> | string): MediaKind {
  const item = typeof entry === "string" ? { name: entry } : entry;
  const mime = (item.mime ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "text/markdown") return "markdown";
  const ext = entryExt(item);
  if (IMAGE_EXTS.has(ext)) return "image";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (MD_EXTS.has(ext)) return "markdown";
  if (CODE_EXTS.has(ext)) return "code";
  if (ARCHIVE_EXTS.has(ext) || BINARY_EXTS.has(ext)) return "binary";
  return "text";
}

export function entryKindLabel(entry: Pick<FsEntryMeta, "name" | "kind" | "ext" | "mime">): string {
  if (entry.kind === "dir") return "Folder";
  const ext = entryExt(entry);
  const media = mediaKindFor(entry);
  if (media === "image") return ext ? `${ext.toUpperCase()} image` : "Image";
  if (media === "audio") return ext ? `${ext.toUpperCase()} audio` : "Audio";
  if (media === "video") return ext ? `${ext.toUpperCase()} video` : "Video";
  if (media === "markdown") return "Markdown";
  if (ARCHIVE_EXTS.has(ext)) return "Archive";
  if (media === "code") return ext ? `${ext.toUpperCase()} code` : "Code";
  return ext ? `${ext.toUpperCase()} file` : "File";
}

export function entryBadgeText(entry: Pick<FsEntryMeta, "name" | "kind" | "ext" | "mime">): string {
  if (entry.kind === "dir") return "DIR";
  const ext = entryExt(entry);
  if (ext && ext.length <= 4) return ext.toUpperCase();
  const media = mediaKindFor(entry);
  if (media === "image") return "IMG";
  if (media === "audio") return "AUD";
  if (media === "video") return "VID";
  return "FILE";
}

export function isHiddenEntry(entry: Pick<FsEntryMeta, "name">): boolean {
  return entry.name.startsWith(".");
}

export function formatMtime(mtime?: number): string {
  if (typeof mtime !== "number" || !Number.isFinite(mtime) || mtime <= 0) return "-";
  const d = new Date(mtime);
  if (Number.isNaN(d.getTime())) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function filterAndSortEntries(
  entries: readonly FsEntryMeta[],
  opts: { query?: string; showHidden?: boolean; sort?: SortSpec } = {},
): FsEntryMeta[] {
  const showHidden = opts.showHidden ?? true;
  const needle = (opts.query ?? "").trim().toLowerCase();
  const sort: SortSpec = opts.sort ?? { field: "name", dir: "asc" };
  const dirMul = sort.dir === "desc" ? -1 : 1;

  const filtered = entries.filter((entry) => {
    if (!showHidden && isHiddenEntry(entry)) return false;
    if (needle && !entry.name.toLowerCase().includes(needle)) return false;
    return true;
  });

  return filtered.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    let cmp = 0;
    if (sort.field === "size") {
      cmp = a.size - b.size;
    } else if (sort.field === "mtime") {
      cmp = (a.mtime ?? 0) - (b.mtime ?? 0);
    } else if (sort.field === "kind") {
      cmp = entryKindLabel(a).localeCompare(entryKindLabel(b));
    }
    if (cmp === 0) {
      cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    }
    return cmp * dirMul;
  });
}
