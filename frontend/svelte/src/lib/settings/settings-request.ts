import { ApiError } from "../host-api.ts";
import { resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const API_UNAVAILABLE = "MSO API is unavailable. Configure the local backend before retrying.";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const fixed = unit === 0 ? Math.round(value).toString() : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${fixed} ${units[unit]}`;
}

export function formatTimestamp(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "Never";
  if (value === 0) return "Never";
  const ms = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return String(value);
  return new Date(ms).toLocaleString();
}

function statusMessage(status: number, label: string): string {
  if (status === 401) return "Your session is unavailable or this device no longer has access.";
  if (status === 403) return `Owner role is required to manage ${label}.`;
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  return `${label} request failed (${status}).`;
}

export async function requestJson(
  path: string,
  options: {
    method?: "GET" | "POST" | "DELETE";
    body?: Record<string, unknown>;
    label: string;
    timeoutMs?: number;
    signal: AbortSignal;
    fetcher: typeof fetch;
    bridge: ShellBridge;
  },
): Promise<unknown> {
  const method = options.method ?? "GET";
  const res = await options.fetcher(resolveApiUrl(path, options.bridge), {
    method,
    credentials: options.bridge.apiBaseOrigin ? "include" : "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 15_000)]),
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const isJson = res.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!res.ok) throw new ApiError(statusMessage(res.status, options.label), res.status);
    throw new ApiError(API_UNAVAILABLE, 502);
  }
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new ApiError(`The ${options.label} response is invalid.`, 502);
  }
  if (!res.ok) {
    const serverMsg = isRecord(parsed) && typeof parsed.error === "string" && parsed.error.trim()
      ? parsed.error.trim()
      : null;
    if (res.status === 401 || res.status === 403) {
      throw new ApiError(statusMessage(res.status, options.label), res.status);
    }
    throw new ApiError(serverMsg ?? statusMessage(res.status, options.label), res.status);
  }
  return parsed;
}

export const SETTINGS_API_UNAVAILABLE = API_UNAVAILABLE;
