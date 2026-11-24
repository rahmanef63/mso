import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";
import { readManagedApps, safeDashboardUrl, type ManagedAppItem } from "../managed-apps/managed-apps-api.ts";

import type {
  CamoufoxSession, CamoufoxStatus, DesktopContainerItem,
} from "./runtime-apps-types.ts";

export { ApiError, safeDashboardUrl, type ManagedAppItem, type ShellBridge };
export type {
  CamoufoxPowerAction, CamoufoxSession, CamoufoxStatus, DesktopContainerItem,
  DesktopContainersResponse, DesktopLifecycleAction, DesktopLifecycleResult,
} from "./runtime-apps-types.ts";

const ANSI_CSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const CTRL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isNullableStr = (v: unknown): v is string | null => v === null || typeof v === "string";
const isOptStr = (v: unknown): v is string | undefined => v === undefined || typeof v === "string";
const isOptBool = (v: unknown): v is boolean | undefined => v === undefined || typeof v === "boolean";

function statusMessage(status: number, label: string): string {
  if (status === 401 || status === 403) return "Your session is unavailable or this device no longer has access.";
  if (status === 404) return `${label} is unavailable on this host.`;
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  if (status === 503) return `${label} is temporarily unavailable. Retry when ready.`;
  return `${label} request failed (${status}).`;
}

async function requestJson(
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

function validateCamoufoxStatus(value: unknown): CamoufoxStatus {
  if (!isRecord(value) || typeof value.running !== "boolean" || !isOptBool(value.enabled)
      || !isOptBool(value.installed) || !isOptBool(value.viewerReady)
      || !isOptStr(value.activeState) || !isOptStr(value.unit) || !isOptStr(value.detail)) {
    throw new ApiError("The MSO Camoufox status response is invalid.", 502);
  }
  return {
    running: value.running,
    ...(value.enabled !== undefined ? { enabled: value.enabled } : {}),
    ...(value.installed !== undefined ? { installed: value.installed } : {}),
    ...(value.viewerReady !== undefined ? { viewerReady: value.viewerReady } : {}),
    ...(value.activeState !== undefined ? { activeState: value.activeState } : {}),
    ...(value.unit !== undefined ? { unit: value.unit } : {}),
    ...(value.detail !== undefined ? { detail: value.detail } : {}),
  };
}

function validateCamoufoxSession(value: unknown): CamoufoxSession {
  if (!isRecord(value)) throw new ApiError("The MSO Camoufox session response is invalid.", 502);
  const rawOrigin = value.viewerOrigin;
  const rawPrefix = value.viewerPathPrefix;
  if ((rawOrigin !== undefined && !isNullableStr(rawOrigin))
      || (rawPrefix !== undefined && !isNullableStr(rawPrefix))
      || (value.password !== undefined && !isNullableStr(value.password))) {
    throw new ApiError("The MSO Camoufox session response is invalid.", 502);
  }
  return {
    hasPassword: typeof value.password === "string" && value.password.trim().length > 0,
    viewerOrigin: typeof rawOrigin === "string" && rawOrigin.trim() ? rawOrigin.trim() : null,
    viewerPathPrefix: typeof rawPrefix === "string" && rawPrefix.trim() ? rawPrefix.trim() : null,
  };
}

function validateContainer(item: unknown): DesktopContainerItem {
  if (!isRecord(item) || !isNonEmpty(item.id) || typeof item.name !== "string"
      || typeof item.state !== "string" || typeof item.status !== "string"
      || typeof item.created !== "string" || typeof item.ports !== "string"
      || !isRecord(item.labels) || !isNullableStr(item.labels.user) || !isNullableStr(item.labels.bot)) {
    throw new ApiError("The MSO desktop containers response is invalid.", 502);
  }
  return {
    id: item.id, name: item.name, state: item.state, status: item.status,
    labels: { user: item.labels.user, bot: item.labels.bot }, created: item.created, ports: item.ports,
  };
}
export * from "./runtime-apps-requests.ts";
