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
