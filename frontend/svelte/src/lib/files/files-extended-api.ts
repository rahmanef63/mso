import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";
import { deleteFsEntry } from "./files-api.ts";
import { copyFsEntry, moveFsEntry, validateFsPath } from "./files-ops-api.ts";
import { joinFsPath, validateEntryName } from "./files-path-utils.ts";
import type { UploadItem } from "./files-meta.ts";

export type FsUsageInfo =
  | { kind: "disk"; used: number; total: number; ratio: number }
  | { kind: "folder"; bytes: number; files: number; dirs?: number };

export type UploadProgressState = { loaded: number; total: number; pct: number };
export type UploadOutcome = { written: number; failed: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const isNonNeg = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

function uploadStatusMessage(status: number): string {
  if (status === 401) return "Your session is unavailable or this path is not accessible.";
  if (status === 403) return "Write permission required for upload.";
  if (status === 404) return "Upload destination was not found.";
  if (status === 413) return "Upload exceeds maximum size limit.";
  if (status === 429) return "Too many uploads in progress. Wait a moment and retry.";
  return `Upload request failed (${status}).`;
}

export function buildRawFileUrl(path: string, bridge: ShellBridge = detectShellBridge()): string {
  const clean = validateFsPath(path, "File path");
  const query = new URLSearchParams({ path: clean }).toString();
  return resolveApiUrl(`/api/v1/fs/raw?${query}`, bridge);
}

export function buildZipDownloadUrl(
  base: string,
  names: readonly string[],
  options: { name?: string; exclude?: readonly string[] } = {},
  bridge: ShellBridge = detectShellBridge(),
): string {
  const cleanBase = validateFsPath(base, "Archive base path");
  const cleanNames = names.map((n) => n.trim()).filter(Boolean);
  if (cleanNames.length === 0) throw new ApiError("Select at least one item to archive.", 400);
  for (const item of cleanNames) {
    const err = validateEntryName(item, "Archive entry");
    if (err) throw new ApiError(err, 400);
  }
  const params = new URLSearchParams({ base: cleanBase });
  for (const item of cleanNames) params.append("n", item);
  for (const skip of options.exclude ?? []) {
    if (skip.trim()) params.append("x", skip.trim());
  }
  if (options.name?.trim()) {
    const safeName = options.name.trim().replace(/[^\w.\-]+/g, "_");
    params.set("name", safeName.endsWith(".zip") ? safeName : `${safeName}.zip`);
  }
  return resolveApiUrl(`/api/v1/fs/zip?${params.toString()}`, bridge);
}

export async function fetchFsUsage(
  path?: string,
  signal: AbortSignal = new AbortController().signal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<FsUsageInfo> {
  const query = path ? `?${new URLSearchParams({ path: validateFsPath(path, "Usage path") }).toString()}` : "";
  const response = await fetcher(resolveApiUrl(`/api/v1/fs/usage${query}`, bridge), {
    method: "GET",
    credentials: bridge.apiBaseOrigin ? "include" : "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    headers: { Accept: "application/json" },
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson || !response.ok) {
    throw new ApiError(`Disk usage unavailable (${response.status}).`, response.status || 502);
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new ApiError("Disk usage response contained invalid JSON.", 502);
  }
  if (!isRecord(raw)) throw new ApiError("Disk usage response is invalid.", 502);
  if (isNonNeg(raw.used) && isNonNeg(raw.total)) {
    const ratio = raw.total > 0 ? Math.min(1, raw.used / raw.total) : 0;
    return { kind: "disk", used: raw.used, total: raw.total, ratio };
  }
  if (isNonNeg(raw.bytes) && isNonNeg(raw.files)) {
    return {
      kind: "folder",
      bytes: raw.bytes,
      files: raw.files,
      ...(isNonNeg(raw.dirs) ? { dirs: raw.dirs } : {}),
    };
  }
  throw new ApiError("Disk usage response is invalid.", 502);
}

function parseUploadOutcome(raw: unknown): UploadOutcome {
  if (!isRecord(raw) || !isNonNeg(raw.written)) {
    throw new ApiError("Upload response is invalid.", 502);
  }
  const failed = Array.isArray(raw.failed)
    ? raw.failed.filter((item): item is string => typeof item === "string")
    : [];
  return { written: raw.written, failed };
}

export async function uploadFsFiles(
  dest: string,
  items: readonly UploadItem[],
  signal: AbortSignal = new AbortController().signal,
  options: {
    onProgress?: (progress: UploadProgressState) => void;
    fetcher?: typeof fetch;
    bridge?: ShellBridge;
  } = {},
): Promise<UploadOutcome> {
  const cleanDest = validateFsPath(dest, "Upload destination");
  if (!items.length) throw new ApiError("Select at least one file to upload.", 400);

  const form = new FormData();
  // Server requires `dest` field before file parts in multipart stream.
  form.append("dest", cleanDest);
  let totalBytes = 0;
  for (const item of items) {
    const rel = (item.relPath || item.file.name || "file").replace(/^\/+/, "");
    form.append("file", item.file, rel);
    totalBytes += item.file.size;
  }

  const bridge = options.bridge ?? detectShellBridge();
  const url = resolveApiUrl("/api/v1/fs/upload", bridge);
  options.onProgress?.({ loaded: 0, total: totalBytes, pct: 0 });

  if (!options.fetcher && options.onProgress && typeof XMLHttpRequest !== "undefined") {
    return new Promise<UploadOutcome>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const onAbort = () => xhr.abort();
      signal.addEventListener("abort", onAbort, { once: true });
      xhr.open("POST", url);
      xhr.withCredentials = Boolean(bridge.apiBaseOrigin);
      xhr.upload.onprogress = (ev) => {
        const total = ev.lengthComputable && ev.total > 0 ? ev.total : totalBytes;
        const pct = total > 0 ? Math.min(99, Math.round((ev.loaded / total) * 100)) : 50;
        options.onProgress?.({ loaded: ev.loaded, total, pct });
      };
      xhr.onload = () => {
        signal.removeEventListener("abort", onAbort);
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new ApiError(uploadStatusMessage(xhr.status), xhr.status));
          return;
        }
        try {
          const parsed = parseUploadOutcome(JSON.parse(xhr.responseText));
          options.onProgress?.({ loaded: totalBytes, total: totalBytes, pct: 100 });
          resolve(parsed);
        } catch (err) {
          reject(err instanceof ApiError ? err : new ApiError("Upload response contained invalid JSON.", 502));
        }
      };
      xhr.onerror = () => {
        signal.removeEventListener("abort", onAbort);
        reject(new ApiError("Network error while uploading files.", 502));
      };
      xhr.onabort = () => {
        signal.removeEventListener("abort", onAbort);
        reject(new ApiError("Upload cancelled.", 499));
      };
      xhr.send(form);
    });
  }

  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(url, {
    method: "POST",
    credentials: bridge.apiBaseOrigin ? "include" : "same-origin",
    cache: "no-store",
    signal,
    body: form,
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!response.ok) throw new ApiError(uploadStatusMessage(response.status), response.status);
  if (!isJson) throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new ApiError("Upload response contained invalid JSON.", 502);
  }
  const parsed = parseUploadOutcome(raw);
  options.onProgress?.({ loaded: totalBytes, total: totalBytes, pct: 100 });
  return parsed;
}
export { renameFsEntry, batchDeleteFsEntries, batchTransferFsEntries } from "./files-batch-api.ts";
