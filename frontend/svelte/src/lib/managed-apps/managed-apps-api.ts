import type { PackageUpdate, PackageUpdateSummary } from "../../../../../lib/contracts/os-api";
import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export type { PackageUpdate, PackageUpdateSummary, ShellBridge };
export { ApiError };
export type ManagedAppInstallationType = "systemd" | "docker" | "package" | "not-installed";
export type ManagedAppRunState = "not-installed" | "stopped" | "starting" | "running" | "unhealthy" | "error";
export type ManagedAppAction = "start" | "stop" | "restart" | "backup";
export type PackageManagerName = NonNullable<PackageUpdateSummary["manager"]>;
export type ManagedAppItem = {
  id: string; name: string; description: string; installed: boolean;
  installationType: ManagedAppInstallationType; state: ManagedAppRunState; healthy: boolean | null;
  version: string | null; dashboardAvailable: boolean; publicDashboardUrl: string | null;
  supportedActions: ManagedAppAction[]; diagnostic: string | null; domainDiagnostic?: string | null;
};
export type ManagedAppsState = { kind: "loading" } | { kind: "ready"; apps: ManagedAppItem[] } | { kind: "error"; message: string };
export type PackagesState =
  | { kind: "loading" }
  | { kind: "ready"; summary: PackageUpdateSummary }
  | { kind: "unavailable"; summary: PackageUpdateSummary; message: string }
  | { kind: "error"; message: string };

const INSTALL_TYPES = new Set<ManagedAppInstallationType>(["systemd", "docker", "package", "not-installed"]);
const APP_STATES = new Set<ManagedAppRunState>(["not-installed", "stopped", "starting", "running", "unhealthy", "error"]);
const APP_ACTIONS = new Set<ManagedAppAction>(["start", "stop", "restart", "backup"]);
const PKG_MANAGERS = new Set<PackageManagerName>(["apt", "dnf", "yum", "pacman", "zypper"]);
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isNullableStr = (v: unknown): v is string | null => v === null || typeof v === "string";
const isOptionalStr = (v: unknown): v is string | undefined => v === undefined || typeof v === "string";

export function safeDashboardUrl(raw: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = new URL(raw.trim());
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password
      ? parsed.href : null;
  } catch { return null; }
}

function statusMessage(status: number, label: string): string {
  if (status === 401 || status === 403) return "Your session is unavailable or this device no longer has access.";
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  if (status === 503) return `${label} is temporarily unavailable. Retry when ready.`;
  return `${label} request failed (${status}).`;
}

async function fetchJson(
  path: string, label: string, signal: AbortSignal, fetcher: typeof fetch, bridge: ShellBridge,
): Promise<unknown> {
  const response = await fetcher(resolveApiUrl(path, bridge), {
    method: "GET", credentials: bridge.apiBaseOrigin ? "include" : "same-origin", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), headers: { Accept: "application/json" },
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

function validateManagedApps(value: unknown): ManagedAppItem[] {
  if (!isRecord(value) || !Array.isArray(value.apps)) throw new ApiError("The MSO managed apps response is invalid.", 502);
  return value.apps.map((item) => {
    if (!isRecord(item) || !isNonEmpty(item.id) || !isNonEmpty(item.name) || typeof item.description !== "string"
        || typeof item.installed !== "boolean" || !INSTALL_TYPES.has(item.installationType as ManagedAppInstallationType)
        || !APP_STATES.has(item.state as ManagedAppRunState)
        || (item.healthy !== null && typeof item.healthy !== "boolean")
        || !isNullableStr(item.version) || typeof item.dashboardAvailable !== "boolean"
        || !isNullableStr(item.publicDashboardUrl) || !Array.isArray(item.supportedActions)
        || !item.supportedActions.every((act) => APP_ACTIONS.has(act as ManagedAppAction))
        || !isNullableStr(item.diagnostic)
        || (item.domainDiagnostic !== undefined && !isNullableStr(item.domainDiagnostic))) {
      throw new ApiError("The MSO managed apps response is invalid.", 502);
    }
    return {
      id: item.id, name: item.name, description: item.description, installed: item.installed,
      installationType: item.installationType as ManagedAppInstallationType, state: item.state as ManagedAppRunState,
      healthy: item.healthy, version: item.version, dashboardAvailable: item.dashboardAvailable,
      publicDashboardUrl: item.publicDashboardUrl, supportedActions: [...(item.supportedActions as ManagedAppAction[])],
      diagnostic: item.diagnostic, ...(item.domainDiagnostic !== undefined ? { domainDiagnostic: item.domainDiagnostic } : {}),
    };
  });
}

function validatePackages(value: unknown): PackageUpdateSummary {
  if (!isRecord(value) || (value.manager !== null && !PKG_MANAGERS.has(value.manager as PackageManagerName))
      || typeof value.available !== "boolean" || !Array.isArray(value.updates)
      || typeof value.truncated !== "boolean" || !isNonEmpty(value.checkedAt)
      || value.source !== "local-cache" || !isOptionalStr(value.diagnostic)) {
    throw new ApiError("The MSO package cache response is invalid.", 502);
  }
  const updates: PackageUpdate[] = value.updates.map((item) => {
    if (!isRecord(item) || !isNonEmpty(item.name) || !isNonEmpty(item.candidate)
        || !isOptionalStr(item.current) || !isOptionalStr(item.architecture)) {
      throw new ApiError("The MSO package cache response is invalid.", 502);
    }
    return {
      name: item.name, candidate: item.candidate,
      ...(item.current !== undefined ? { current: item.current } : {}),
      ...(item.architecture !== undefined ? { architecture: item.architecture } : {}),
    };
  });
  return {
    manager: value.manager as PackageUpdateSummary["manager"], available: value.available,
    updates, truncated: value.truncated, checkedAt: value.checkedAt, source: "local-cache",
    ...(value.diagnostic !== undefined ? { diagnostic: value.diagnostic } : {}),
  };
}

export async function readManagedApps(signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge()): Promise<ManagedAppItem[]> {
  return validateManagedApps(await fetchJson("/api/v1/managed-apps", "Managed apps", signal, fetcher, bridge));
}
export async function readPackages(signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge()): Promise<PackageUpdateSummary> {
  return validatePackages(await fetchJson("/api/v1/sys/packages", "Package cache", signal, fetcher, bridge));
}

function createOneShotController<T, S>(
  load: (signal: AbortSignal) => Promise<T>, toReady: (data: T) => S, update: (state: S) => void,
  loadingState: S, toError: (message: string) => S, fallbackError: string,
) {
  let generation = 0; let active: AbortController | undefined; let disposed = false;
  return {
    async refresh() {
      if (disposed) return;
      const run = ++generation; active?.abort();
      const controller = (active = new AbortController());
      update(loadingState);
      try {
        const data = await load(controller.signal);
        if (!disposed && run === generation) update(toReady(data));
      } catch (error) {
        if (!disposed && run === generation && !controller.signal.aborted) {
          update(toError(error instanceof ApiError ? error.message : fallbackError));
        }
      }
    },
    dispose() { disposed = true; generation++; active?.abort(); },
  };
}

export function createManagedAppsController(update: (state: ManagedAppsState) => void, fetcher = fetch, bridge?: ShellBridge) {
  return createOneShotController(
    (signal) => readManagedApps(signal, fetcher, bridge), (apps): ManagedAppsState => ({ kind: "ready", apps }),
    update, { kind: "loading" }, (message): ManagedAppsState => ({ kind: "error", message }),
    "Could not load managed applications. Check the backend and retry.",
  );
}
export function createPackagesController(update: (state: PackagesState) => void, fetcher = fetch, bridge?: ShellBridge) {
  return createOneShotController(
    (signal) => readPackages(signal, fetcher, bridge),
    (summary): PackagesState => summary.available
      ? { kind: "ready", summary }
      : { kind: "unavailable", summary, message: summary.diagnostic?.trim() || "Local package cache is unavailable on this host." },
    update, { kind: "loading" }, (message): PackagesState => ({ kind: "error", message }),
    "Could not load package cache. Check the backend and retry.",
  );
}
