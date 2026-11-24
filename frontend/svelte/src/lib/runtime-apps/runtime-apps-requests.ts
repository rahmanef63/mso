import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";
import { safeDashboardUrl } from "../managed-apps/managed-apps-api.ts";
import { requestJson } from "./runtime-apps-client.ts";
import { ANSI_CSI_RE, CTRL_RE, isNonEmpty, isRecord } from "./runtime-apps-guards.ts";
import { validateCamoufoxSession, validateCamoufoxStatus, validateContainer } from "./runtime-apps-client.ts";
import { LIFECYCLE_ACTIONS } from "./runtime-apps-types.ts";
import { readManagedApps, type ManagedAppItem } from "../managed-apps/managed-apps-api.ts";
import type {
  CamoufoxPowerAction, CamoufoxSession, CamoufoxStatus, DesktopContainersResponse,
  DesktopLifecycleAction, DesktopLifecycleResult,
} from "./runtime-apps-types.ts";

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
