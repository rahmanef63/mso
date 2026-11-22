import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export { ApiError };
export type { ShellBridge };

export type MediaKind = "image" | "audio" | "video" | "text" | "unsupported";

export type StockImageItem = {
  id: string;
  thumb: string;
  url: string;
  title: string;
  creator: string;
  license: string;
};

export type StockSearchResponse = {
  results: StockImageItem[];
};

export type IconDefinition = {
  id: string;
  label: string;
  category: string;
  glyph: string;
};

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "mkv", "ogv", "m4v"]);
const TEXT_EXT = new Set([
  "txt", "md", "markdown", "json", "yaml", "yml", "toml", "xml", "csv", "log",
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "svelte", "html", "css", "rs", "py",
  "go", "sh", "sql", "ini", "conf",
]);

export const ICON_CATALOG: readonly IconDefinition[] = [
  { id: "home", label: "Home", category: "navigation", glyph: "\u2302" },
  { id: "search", label: "Search", category: "navigation", glyph: "\u2315" },
  { id: "compass", label: "Explore", category: "navigation", glyph: "\u25CE" },
  { id: "layers", label: "Layers", category: "navigation", glyph: "\u29C9" },
  { id: "folder", label: "Folder", category: "files", glyph: "\u25A3" },
  { id: "file-text", label: "Document", category: "files", glyph: "\u2630" },
  { id: "code", label: "Code", category: "files", glyph: "</>" },
  { id: "archive", label: "Archive", category: "files", glyph: "\u25A6" },
  { id: "image", label: "Image", category: "media", glyph: "\u25A8" },
  { id: "music", label: "Audio", category: "media", glyph: "\u266B" },
  { id: "film", label: "Video", category: "media", glyph: "\u25B6" },
  { id: "camera", label: "Camera", category: "media", glyph: "\u25C9" },
  { id: "terminal", label: "Terminal", category: "system", glyph: ">_" },
  { id: "cpu", label: "Processor", category: "system", glyph: "\u25A9" },
  { id: "server", label: "Server", category: "system", glyph: "\u2261" },
  { id: "shield", label: "Security", category: "system", glyph: "\u25C6" },
  { id: "settings", label: "Settings", category: "system", glyph: "\u2699" },
  { id: "globe", label: "Web App", category: "network", glyph: "\u25CD" },
  { id: "link", label: "Link", category: "network", glyph: "\u221E" },
  { id: "cloud", label: "Cloud", category: "network", glyph: "\u2601" },
  { id: "bell", label: "Alerts", category: "communication", glyph: "\u25C8" },
  { id: "mail", label: "Messages", category: "communication", glyph: "\u2709" },
  { id: "spark", label: "Assistant", category: "actions", glyph: "\u2726" },
  { id: "check", label: "Verified", category: "actions", glyph: "\u2713" },
];

export function filterIcons(query: string): IconDefinition[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...ICON_CATALOG];
  return ICON_CATALOG.filter((icon) =>
    `${icon.id} ${icon.label} ${icon.category}`.toLowerCase().includes(q),
  );
}

export function classifyMediaKind(path: string): MediaKind {
  const clean = path.trim().split(/[?#]/, 1)[0] ?? "";
  const base = clean.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "unsupported";
  const ext = base.slice(dot + 1).toLowerCase();
  if (IMAGE_EXT.has(ext)) return "image";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (VIDEO_EXT.has(ext)) return "video";
  if (TEXT_EXT.has(ext)) return "text";
  return "unsupported";
}

export function resolveRawMediaUrl(path: string, bridge: ShellBridge = detectShellBridge()): string {
  const trimmed = path.trim();
  if (!trimmed) throw new Error("Media path is required.");
  return resolveApiUrl(`/api/v1/fs/raw?path=${encodeURIComponent(trimmed)}`, bridge);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function isSafeHttpUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function statusMessage(status: number): string {
  if (status === 400) return "Enter a valid search query.";
  if (status === 401 || status === 403) return "Your session is unavailable. Sign in and retry.";
  if (status === 429) return "Too many stock image requests. Wait a moment and retry.";
  if (status === 502 || status === 503) return "Stock image search is temporarily unavailable. Retry when ready.";
  return `Stock image search failed (${status}).`;
}

function parseStockItem(raw: unknown): StockImageItem | null {
  if (!isRecord(raw) || !isSafeHttpUrl(raw.url)) return null;
  const url = raw.url.trim();
  let thumb = url;
  if (typeof raw.thumb === "string" && raw.thumb.trim().length > 0) {
    if (!isSafeHttpUrl(raw.thumb)) return null;
    thumb = raw.thumb.trim();
  }
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : url;
  return {
    id,
    thumb,
    url,
    title: typeof raw.title === "string" ? raw.title.trim() : "",
    creator: typeof raw.creator === "string" ? raw.creator.trim() : "",
    license: typeof raw.license === "string" ? raw.license.trim() : "",
  };
}

export async function searchStockImages(
  query: string,
  page: number,
  signal: AbortSignal,
  fetcher = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<StockSearchResponse> {
  const q = query.trim();
  if (!q) throw new ApiError("Enter a search query.", 400);
  const safePage = Math.max(1, Math.trunc(Number(page)) || 1);
  const endpoint = resolveApiUrl(
    `/api/v1/stock/search?q=${encodeURIComponent(q)}&page=${safePage}`,
    bridge,
  );
  const response = await fetcher(endpoint, {
    method: "GET",
    credentials: bridge.apiBaseOrigin ? "include" : "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    headers: { Accept: "application/json" },
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError("The stock image response is invalid.", 502);
  }
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new ApiError("The stock image response is invalid.", 502);
  }
  const results: StockImageItem[] = [];
  for (const entry of payload.results) {
    const item = parseStockItem(entry);
    if (item) results.push(item);
  }
  return { results };
}
