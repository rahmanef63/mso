import type { FsEntry, FsList, FsRoot } from "../../../../../lib/contracts/os-api";
import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export { ApiError };
export type FsEntryMeta = FsEntry & { mtime?: number };
export type FsListMeta = Omit<FsList, "entries"> & { entries: FsEntryMeta[] };
export type { FsEntry, FsList, FsRoot, ShellBridge };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function statusMessage(status: number, mutation = false): string {
  if (status === 401) return "Your session is unavailable or this path is not accessible.";
  if (status === 403) {
    return mutation ? "Write permission required for this operation." : "Your session is unavailable or this path is not accessible.";
  }
  if (status === 404) return "The requested path was not found.";
  if (status === 408) return "Filesystem request timed out. Choose a narrower directory.";
  if (status === 409) return "A file or folder conflict prevented this operation.";
  if (status === 413) return "Directory or file is too large for this operation.";
  if (status === 429) return "Too many filesystem requests. Wait a moment and retry.";
  return `MSO files API request failed (${status}).`;
}

async function fetchFsJson(
  path: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
  bridge: ShellBridge = detectShellBridge(),
  options: { method?: "GET" | "POST" | "DELETE"; body?: unknown } = {},
): Promise<unknown> {
  const method = options.method ?? "GET";
  const mutation = method !== "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = {
    method,
    credentials: bridge.apiBaseOrigin ? "include" : "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    headers,
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  const response = await fetcher(resolveApiUrl(path, bridge), init);
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status, mutation), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status, mutation), response.status);
  try {
    return await response.json();
  } catch {
    throw new ApiError("The MSO files API returned invalid JSON.", 502);
  }
}

function validateEntry(raw: unknown): FsEntryMeta {
  if (!isRecord(raw) || typeof raw.name !== "string" || !raw.name
      || (raw.kind !== "dir" && raw.kind !== "file") || !isNonNegative(raw.size)
      || (raw.ext !== undefined && typeof raw.ext !== "string")
      || (raw.mime !== undefined && typeof raw.mime !== "string")) {
    throw new ApiError("The MSO directory listing response is invalid.", 502);
  }
  let mtime: number | undefined;
  if (isNonNegative(raw.mtime)) {
    mtime = raw.mtime;
  } else if (typeof raw.mtime === "string") {
    const parsed = Date.parse(raw.mtime);
    if (Number.isFinite(parsed) && parsed >= 0) mtime = parsed;
  }
  return {
    name: raw.name,
    kind: raw.kind,
    size: raw.size,
    ...(raw.ext !== undefined ? { ext: raw.ext } : {}),
    ...(raw.mime !== undefined ? { mime: raw.mime } : {}),
    ...(mtime !== undefined ? { mtime } : {}),
  };
}

function validateRoots(raw: unknown): FsRoot[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new ApiError("The MSO directory listing response is invalid.", 502);
  return raw.map((item) => {
    if (!isRecord(item) || typeof item.label !== "string" || typeof item.path !== "string") {
      throw new ApiError("The MSO directory listing response is invalid.", 502);
    }
    return { label: item.label, path: item.path };
  });
}

export async function listDirectory(
  path: string,
  signal: AbortSignal,
  fetcher = fetch,
  bridge = detectShellBridge(),
): Promise<FsListMeta> {
  const query = new URLSearchParams({ path: path || "~" }).toString();
  const value = await fetchFsJson(`/api/v1/fs/list?${query}`, signal, fetcher, bridge);
  if (!isRecord(value) || typeof value.path !== "string" || !value.path || !Array.isArray(value.entries)
      || (value.parent !== undefined && value.parent !== null && typeof value.parent !== "string")) {
    throw new ApiError("The MSO directory listing response is invalid.", 502);
  }
  const roots = validateRoots(value.roots);
  return {
    path: value.path,
    entries: value.entries.map(validateEntry),
    ...(roots !== undefined ? { roots } : {}),
    ...(value.parent !== undefined ? { parent: value.parent } : {}),
  };
}

export async function readTextFile(
  path: string,
  signal: AbortSignal,
  fetcher = fetch,
  bridge = detectShellBridge(),
): Promise<string> {
  if (!path.trim()) throw new ApiError("File path is required.", 400);
  const query = new URLSearchParams({ path }).toString();
  const value = await fetchFsJson(`/api/v1/fs/read?${query}`, signal, fetcher, bridge);
  if (typeof value !== "string") throw new ApiError("The MSO file read response is invalid.", 502);
  return value;
}

export async function writeTextFile(
  path: string,
  content: string,
  signal: AbortSignal,
  fetcher = fetch,
  bridge = detectShellBridge(),
): Promise<void> {
  if (!path.trim()) throw new ApiError("File path is required.", 400);
  const value = await fetchFsJson("/api/v1/fs/write", signal, fetcher, bridge, {
    method: "POST",
    body: { path, content },
  });
  if (!isRecord(value) || value.ok !== true) {
    throw new ApiError("The MSO file write response is invalid.", 502);
  }
}

export async function createDirectory(
  path: string,
  signal: AbortSignal,
  fetcher = fetch,
  bridge = detectShellBridge(),
): Promise<void> {
  if (!path.trim()) throw new ApiError("Directory path is required.", 400);
  const value = await fetchFsJson("/api/v1/fs/mkdir", signal, fetcher, bridge, {
    method: "POST",
    body: { path },
  });
  if (!isRecord(value) || value.kind !== "dir") {
    throw new ApiError("The MSO directory creation response is invalid.", 502);
  }
}

export async function deleteFsEntry(
  path: string,
  signal: AbortSignal,
  fetcher = fetch,
  bridge = detectShellBridge(),
): Promise<void> {
  if (!path.trim()) throw new ApiError("Entry path is required.", 400);
  const value = await fetchFsJson("/api/v1/fs/delete", signal, fetcher, bridge, {
    method: "DELETE",
    body: { path },
  });
  if (!isRecord(value) || value.ok !== true) {
    throw new ApiError("The MSO delete response is invalid.", 502);
  }
}
