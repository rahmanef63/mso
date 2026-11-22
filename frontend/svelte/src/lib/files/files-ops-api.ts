import type { FsHit } from "../../../../../lib/contracts/os-api.ts";
import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export { ApiError };
export type { FsHit, ShellBridge };

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const TRAVERSAL_SEGMENT = /(?:^|[\\/])\.\.(?:$|[\\/])/;
const API_UNAVAILABLE = "MSO API is unavailable. Configure the local backend before retrying.";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function statusMessage(status: number, mutation: boolean): string {
  if (status === 400) return mutation ? "Invalid filesystem operation request." : "Invalid filesystem search request.";
  if (status === 401) return "Your session is unavailable or this path is not accessible.";
  if (status === 403) {
    return mutation
      ? "Write permission required for this operation."
      : "Your session is unavailable or this path is not accessible.";
  }
  if (status === 404) return "The requested path was not found.";
  if (status === 408) return "Filesystem request timed out. Choose a narrower directory.";
  if (status === 409) return "A file or folder conflict prevented this operation.";
  if (status === 413) return "Directory or file is too large for this operation.";
  if (status === 429) return "Too many filesystem requests. Wait a moment and retry.";
  return `MSO files API request failed (${status}).`;
}

export function validateFsPath(raw: string, label = "Path"): string {
  const clean = typeof raw === "string" ? raw.trim() : "";
  if (!clean) throw new ApiError(`${label} is required.`, 400);
  if (CONTROL_CHARS.test(clean)) throw new ApiError(`${label} contains invalid characters.`, 400);
  if (TRAVERSAL_SEGMENT.test(clean)) {
    throw new ApiError(`${label} cannot contain parent traversal segments.`, 400);
  }
  return clean;
}

function validateTransferPaths(from: string, to: string): { from: string; to: string } {
  const cleanFrom = validateFsPath(from, "Source path");
  const cleanTo = validateFsPath(to, "Destination path");
  const normFrom = cleanFrom.length > 1 ? cleanFrom.replace(/\/+$/, "") : cleanFrom;
  const normTo = cleanTo.length > 1 ? cleanTo.replace(/\/+$/, "") : cleanTo;
  if (normFrom === normTo) {
    throw new ApiError("Source and destination paths must be different.", 400);
  }
  if (normFrom !== "/" && normTo.startsWith(`${normFrom}/`)) {
    throw new ApiError("Destination cannot be inside the source path.", 400);
  }
  return { from: cleanFrom, to: cleanTo };
}

async function fetchFsOpsJson(
  path: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
  bridge: ShellBridge,
  options: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<unknown> {
  const method = options.method ?? "GET";
  const mutation = method !== "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = {
    method,
    credentials: bridge.apiBaseOrigin ? "include" : "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
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
    throw new ApiError(API_UNAVAILABLE, 502);
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status, mutation), response.status);
  try {
    return await response.json();
  } catch {
    throw new ApiError("The MSO files API returned invalid JSON.", 502);
  }
}

function validateHit(raw: unknown): FsHit {
  if (
    !isRecord(raw)
    || typeof raw.name !== "string" || !raw.name.trim()
    || typeof raw.path !== "string" || !raw.path.trim()
    || (raw.kind !== "dir" && raw.kind !== "file")
  ) {
    throw new ApiError("The MSO search response is invalid.", 502);
  }
  return { name: raw.name, path: raw.path, kind: raw.kind };
}

export async function copyFsEntry(
  from: string,
  to: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<void> {
  const payload = validateTransferPaths(from, to);
  const value = await fetchFsOpsJson("/api/v1/fs/copy", signal, fetcher, bridge, {
    method: "POST",
    body: payload,
  });
  if (!isRecord(value) || value.ok !== true) {
    throw new ApiError("The MSO copy response is invalid.", 502);
  }
}

export async function moveFsEntry(
  from: string,
  to: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<void> {
  const payload = validateTransferPaths(from, to);
  const value = await fetchFsOpsJson("/api/v1/fs/move", signal, fetcher, bridge, {
    method: "POST",
    body: payload,
  });
  if (!isRecord(value) || value.ok !== true) {
    throw new ApiError("The MSO move response is invalid.", 502);
  }
}

export async function searchFs(
  query: string,
  dir?: string,
  signal: AbortSignal = new AbortController().signal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<FsHit[]> {
  const cleanDir = dir !== undefined ? validateFsPath(dir, "Search directory") : undefined;
  if (typeof query !== "string" || CONTROL_CHARS.test(query)) {
    throw new ApiError("Search query contains invalid characters.", 400);
  }
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];
  const params = new URLSearchParams({ q: cleanQuery });
  if (cleanDir !== undefined) params.set("root", cleanDir);
  const value = await fetchFsOpsJson(`/api/v1/fs/search?${params.toString()}`, signal, fetcher, bridge);
  if (!Array.isArray(value)) throw new ApiError("The MSO search response is invalid.", 502);
  return value.map(validateHit);
}
