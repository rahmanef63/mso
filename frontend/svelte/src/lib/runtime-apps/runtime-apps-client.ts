import { ApiError } from "../host-api.ts";
import { resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";
import type { CamoufoxStatus } from "./runtime-apps-types.ts";
import { isRecord } from "./runtime-apps-guards.ts";

export function statusMessage(status: number, label: string): string {
  if (status === 401 || status === 403) return "Your session is unavailable or this device no longer has access.";
  if (status === 404) return `${label} is unavailable on this host.`;
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  if (status === 503) return `${label} is temporarily unavailable. Retry when ready.`;
  return `${label} request failed (${status}).`;
}

export async function requestJson(
  method: "GET" | "POST", path: string, label: string, signal: AbortSignal,
  fetcher: typeof fetch, bridge: ShellBridge, payload?: Record<string, unknown>,
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: string | undefined;
  if (payload !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(payload);
  }
  const response = await fetcher(resolveApiUrl(path, bridge), {
    method, credentials: bridge.apiBaseOrigin ? "include" : "same-origin", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]), headers,
    ...(body !== undefined ? { body } : {}),
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status, label), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status, label), response.status);
  try { return await response.json(); } catch {
    throw new ApiError(`The MSO ${label.toLowerCase()} response is invalid.`, 502);
  }
}
export {
  validateCamoufoxSession, validateCamoufoxStatus, validateContainer,
} from "./runtime-apps-validators.ts";
