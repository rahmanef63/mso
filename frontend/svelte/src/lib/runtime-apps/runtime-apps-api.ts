import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";
import { readManagedApps, safeDashboardUrl, type ManagedAppItem } from "../managed-apps/managed-apps-api.ts";

export { ApiError, safeDashboardUrl, type ManagedAppItem, type ShellBridge };

export type CamoufoxPowerAction = "start" | "stop";
export type CamoufoxStatus = {
  running: boolean;
  enabled?: boolean;
  installed?: boolean;
  viewerReady?: boolean;
  activeState?: string;
  unit?: string;
  detail?: string;
};
export type CamoufoxSession = {
  hasPassword: boolean;
  viewerOrigin: string | null;
  viewerPathPrefix: string | null;
};
export type DesktopContainerItem = {
  id: string;
  name: string;
  state: string;
  status: string;
  labels: { user: string | null; bot: string | null };
  created: string;
  ports: string;
};
export type DesktopContainersResponse = { containers: DesktopContainerItem[] };
export type DesktopLifecycleAction = "start" | "stop" | "restart" | "logs";
export type DesktopLifecycleResult = {
  action: DesktopLifecycleAction;
  container: string;
  state: DesktopContainerItem | null;
  logs?: string[];
};

const LIFECYCLE_ACTIONS = new Set<DesktopLifecycleAction>(["start", "stop", "restart", "logs"]);
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

export function safeViewerHref(origin: string | null, pathPrefix: string | null = null): string | null {
  const safeOrigin = safeDashboardUrl(origin);
  if (!safeOrigin) return null;
  if (!pathPrefix || !pathPrefix.trim()) return safeOrigin;
  const clean = pathPrefix.trim();
  if (!clean.startsWith("/") || clean.startsWith("//") || clean.includes("://")) return null;
  try {
    const parsed = new URL(clean, safeOrigin);
    return parsed.origin === new URL(safeOrigin).origin ? parsed.href : null;
  } catch { return null; }
}

/** noVNC entry point for an already-validated viewer href. The session ticket and
 *  password never reach this surface, so the fragment stays empty. */
export function viewerEmbedSrc(href: string | null): string | null {
  if (!href) return null;
  try {
    const origin = new URL(href);
    const prefix = origin.pathname.replace(/\/+$/, "");
    const target = new URL(`${prefix}/vnc.html`, origin.origin);
    const socket = `${prefix.replace(/^\/+/, "")}/websockify`.replace(/^\/+/, "");
    target.searchParams.set("path", socket);
    target.searchParams.set("autoconnect", "1");
    target.searchParams.set("resize", "remote");
    return target.href;
  } catch {
    return null;
  }
}

export function sanitizeLogLines(lines: readonly string[]): string {
  return lines.map((line) => line.replace(ANSI_CSI_RE, "").replace(CTRL_RE, "")).join("\n");
}

export async function readCamoufoxStatus(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<CamoufoxStatus> {
  return validateCamoufoxStatus(await requestJson("GET", "/api/v1/camoufox/service", "Camoufox service", signal, fetcher, bridge));
}

export async function setCamoufoxPower(
  action: CamoufoxPowerAction, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<CamoufoxStatus> {
  return validateCamoufoxStatus(await requestJson("POST", "/api/v1/camoufox/service", "Camoufox service", signal, fetcher, bridge, { action }));
}

export async function readCamoufoxSession(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<CamoufoxSession> {
  return validateCamoufoxSession(await requestJson("GET", "/api/v1/camoufox/session", "Camoufox session", signal, fetcher, bridge));
}

export async function readDesktopContainers(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<DesktopContainersResponse> {
  const value = await requestJson("GET", "/api/v1/desktop/containers", "Desktop containers", signal, fetcher, bridge);
  if (!isRecord(value) || !Array.isArray(value.containers)) {
    throw new ApiError("The MSO desktop containers response is invalid.", 502);
  }
  return { containers: value.containers.map(validateContainer) };
}

export async function runDesktopLifecycle(
  container: string, action: DesktopLifecycleAction, signal: AbortSignal,
  fetcher = fetch, bridge: ShellBridge = detectShellBridge(), lines?: number,
): Promise<DesktopLifecycleResult> {
  const payload: Record<string, unknown> = { container, action, ...(lines !== undefined ? { lines } : {}) };
  const value = await requestJson("POST", "/api/v1/desktop/lifecycle", "Desktop lifecycle", signal, fetcher, bridge, payload);
  if (!isRecord(value) || !LIFECYCLE_ACTIONS.has(value.action as DesktopLifecycleAction)
      || !isNonEmpty(value.container)
      || (value.logs !== undefined && (!Array.isArray(value.logs) || !value.logs.every((l) => typeof l === "string")))) {
    throw new ApiError("The MSO desktop lifecycle response is invalid.", 502);
  }
  const nextState = value.state === null ? null : validateContainer(value.state);
  return {
    action: value.action as DesktopLifecycleAction, container: value.container, state: nextState,
    ...(value.logs !== undefined ? { logs: [...value.logs] } : {}),
  };
}

export function resolveDesktopScreenshotUrl(
  container: string, bridge: ShellBridge = detectShellBridge(), screen?: string,
): string {
  const clean = container.trim();
  if (!clean) throw new ApiError("Desktop container identifier is required.", 400);
  const query = screen?.trim()
    ? `?container=${encodeURIComponent(clean)}&screen=${encodeURIComponent(screen.trim())}`
    : `?container=${encodeURIComponent(clean)}`;
  return resolveApiUrl(`/api/v1/desktop/screenshot${query}`, bridge);
}

export async function readN8nApp(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<ManagedAppItem | null> {
  const apps = await readManagedApps(signal, fetcher, bridge);
  return apps.find((app) => app.id === "n8n") ?? null;
}
