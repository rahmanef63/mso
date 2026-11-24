import type { FsEntryMeta } from "./files-api.ts";

export type SortField = "name" | "size" | "mtime" | "kind";
export type SortDir = "asc" | "desc";
export type SortSpec = { field: SortField; dir: SortDir };
export type MediaKind = "image" | "audio" | "video" | "markdown" | "code" | "text" | "binary";
export type UploadItem = { relPath: string; file: File };

export type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "paragraph"; text: string };

export const HEAVY_ZIP_EXCLUDES = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".cache",
  "__pycache__",
  ".venv",
] as const;

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico", "heic"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "m4v", "mkv", "ogv"]);
const MD_EXTS = new Set(["md", "mdx", "markdown"]);
const CODE_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "svelte", "vue", "py", "rs", "go",
  "java", "kt", "c", "cc", "cpp", "h", "hpp", "css", "scss", "html", "xml",
  "json", "yaml", "yml", "toml", "sh", "bash", "zsh", "sql", "dockerfile",
]);
const ARCHIVE_EXTS = new Set(["zip", "gz", "tgz", "tar", "bz2", "xz", "rar", "7z"]);
const BINARY_EXTS = new Set(["pdf", "wasm", "exe", "bin", "dmg", "iso", "woff", "woff2", "ttf", "otf", "db", "sqlite"]);

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

export function parseMarkdownBlocks(src: string): MarkdownBlock[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }

    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        buf.push(lines[i] ?? "");
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ kind: "code", lang, text: buf.join("\n") });
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      i++;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith(">")) {
        buf.push((lines[i] ?? "").trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", text: buf.join(" ") });
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test((lines[i] ?? "").trim())) {
        items.push((lines[i] ?? "").trim().replace(/^[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "list", items });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length) {
      const cur = (lines[i] ?? "").trim();
      if (!cur || cur.startsWith("```") || /^(#{1,6})\s+/.test(cur) || cur.startsWith(">") || /^[-*+]\s+/.test(cur)) {
        break;
      }
      para.push(cur);
      i++;
    }
    blocks.push({ kind: "paragraph", text: para.join(" ") });
  }
  return blocks;
}

export async function readDropEntries(dt: DataTransfer): Promise<UploadItem[]> {
  const entries = Array.from(dt.items ?? [])
    .map((item) => {
      const withEntry = item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null };
      return item.kind === "file" && typeof withEntry.webkitGetAsEntry === "function"
        ? withEntry.webkitGetAsEntry()
        : null;
    })
    .filter((entry): entry is FileSystemEntry => entry != null);

  if (!entries.length) {
    return Array.from(dt.files ?? []).map((file) => ({ relPath: file.name, file }));
  }

  const out: UploadItem[] = [];
  await Promise.all(entries.map((entry) => walkDropEntry(entry, "", out)));
  if (!out.length) {
    return Array.from(dt.files ?? []).map((file) => ({ relPath: file.name, file }));
  }
  return out;
}

function walkDropEntry(entry: FileSystemEntry, prefix: string, out: UploadItem[]): Promise<void> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file(
        (file) => { out.push({ relPath: prefix + entry.name, file }); resolve(); },
        () => resolve(),
      );
    });
  }
  if (!entry.isDirectory) return Promise.resolve();
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const dirPrefix = `${prefix}${entry.name}/`;
  return new Promise((resolve) => {
    const children: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (!batch.length) {
            void Promise.all(children.map((child) => walkDropEntry(child, dirPrefix, out))).then(() => resolve());
            return;
          }
          children.push(...batch);
          readBatch();
        },
        () => resolve(),
      );
    };
    readBatch();
  });
}
