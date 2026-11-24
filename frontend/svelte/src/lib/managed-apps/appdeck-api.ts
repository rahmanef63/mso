// Transactional AppDeck endpoints. Everything here is one request in, one
// validated answer out; the caller owns the state machine. Reads never mutate,
// and every failure is mapped to a short operator sentence, because the route
// bodies can carry upstream stderr and host paths that must not surface in UI.
import { ApiError } from "./managed-apps-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";
import {
  parseBackups, parseDiscovery, parseJob, parseJobs, parseLogs, parsePreflight, parseTunnels, parseUpdateStatus,
  type AppLogs, type BackupRecord, type DiscoverySnapshot, type JobSummary, type PreflightReport,
  type TunnelSnapshot, type UpdateStatus,
} from "./appdeck-schema.ts";

export type { AppLogs, BackupRecord, DiscoverySnapshot, JobSummary, PreflightReport, TunnelSnapshot, UpdateStatus };
export type LifecycleAction = "start" | "stop" | "restart" | "backup";

const READ_TIMEOUT = 30_000;
const ACTION_TIMEOUT = 90_000;
const JOB_TIMEOUT = 20_000;

export function safeMessage(status: number, label: string): string {
  const noun = label.toLowerCase();
  if (status === 401 || status === 403) return "Your session is unavailable, or this device is not an owner.";
  if (status === 404) return `${label} was not found on this host.`;
  if (status === 409) return `${label} is busy or the operation was refused. Refresh and retry.`;
  if (status === 429) return "Too many operations. Wait a moment and retry.";
  if (status === 503) return `${label} is temporarily unavailable. Retry when ready.`;
  return `The ${noun} request failed (${status}).`;
}

type Call = {
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  label: string;
  timeout?: number;
};

async function call<T>(
  { path, method = "GET", body, label, timeout = READ_TIMEOUT }: Call,
  parse: (value: unknown) => T,
  signal: AbortSignal,
  fetcher: typeof fetch,
  bridge: ShellBridge,
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetcher(resolveApiUrl(path, bridge), {
    method,
    credentials: bridge.apiBaseOrigin ? "include" : "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(safeMessage(response.status, label), response.status);
    throw new ApiError("The MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  if (!response.ok) {
    // The route's own `error` string is deliberately dropped: the install and
    // update routes echo upstream output, which can name host paths.
    throw new ApiError(safeMessage(response.status, label), response.status);
  }
  try {
    return parse(await response.json());
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(`The MSO ${label.toLowerCase()} response is invalid.`, 502);
  }
}

const appPath = (id: string, suffix = ""): string => `/api/v1/managed-apps/${encodeURIComponent(id)}${suffix}`;

export function readPreflight(id: string, signal: AbortSignal, fetcher = fetch, bridge?: ShellBridge): Promise<PreflightReport> {
  return call({ path: appPath(id, "/preflight"), label: "Preflight" }, parsePreflight, signal, fetcher, bridge ?? detectShellBridge());
}
export function readJobs(id: string, signal: AbortSignal, fetcher = fetch, bridge?: ShellBridge): Promise<JobSummary[]> {
  return call({ path: appPath(id, "/jobs"), label: "Job history", timeout: JOB_TIMEOUT }, parseJobs, signal, fetcher, bridge ?? detectShellBridge());
}
export function readLogs(id: string, signal: AbortSignal, fetcher = fetch, bridge?: ShellBridge): Promise<AppLogs> {
  return call({ path: appPath(id, "/logs"), label: "Application log" }, parseLogs, signal, fetcher, bridge ?? detectShellBridge());
}
export function readBackups(id: string, signal: AbortSignal, fetcher = fetch, bridge?: ShellBridge): Promise<BackupRecord[]> {
  return call({ path: appPath(id, "/backups"), label: "Backup list" }, parseBackups, signal, fetcher, bridge ?? detectShellBridge());
}
export function readUpdateStatus(id: string, signal: AbortSignal, fetcher = fetch, bridge?: ShellBridge): Promise<UpdateStatus> {
  return call({ path: appPath(id, "/update"), label: "Update status" }, parseUpdateStatus, signal, fetcher, bridge ?? detectShellBridge());
}
export function readDiscovery(signal: AbortSignal, fetcher = fetch, bridge?: ShellBridge): Promise<DiscoverySnapshot> {
  return call({ path: "/api/v1/managed-apps/discover", label: "Local discovery" }, parseDiscovery, signal, fetcher, bridge ?? detectShellBridge());
}
export function readTunnels(signal: AbortSignal, fetcher = fetch, bridge?: ShellBridge): Promise<TunnelSnapshot> {
  return call({ path: "/api/v1/managed-apps/tunnels", label: "Tunnel list" }, parseTunnels, signal, fetcher, bridge ?? detectShellBridge());
}

export async function runLifecycle(
  id: string, action: LifecycleAction, signal: AbortSignal, fetcher = fetch, bridge?: ShellBridge,
): Promise<void> {
  await call(
    { path: appPath(id), method: "POST", body: { action }, label: "Lifecycle action", timeout: ACTION_TIMEOUT },
    () => undefined, signal, fetcher, bridge ?? detectShellBridge(),
  );
}

// Install and update answer 202 with a job; the caller polls /jobs for progress.
export function startInstall(
  id: string, signal: AbortSignal, fetcher = fetch, bridge?: ShellBridge,
): Promise<JobSummary> {
  return call(
    { path: appPath(id, "/install"), method: "POST", body: {}, label: "Install", timeout: ACTION_TIMEOUT },
    (value) => (isRecord(value) && value.job !== undefined ? parseJob(value.job) : invalidJob()),
    signal, fetcher, bridge ?? detectShellBridge(),
  );
}

export function startUpdate(
  id: string, action: "apply" | "check" | "uninstall", signal: AbortSignal, fetcher = fetch, bridge?: ShellBridge,
): Promise<JobSummary | UpdateStatus> {
  const body = action === "uninstall" ? { action, confirm: id } : { action };
  return call(
    { path: appPath(id, "/update"), method: "POST", body, label: "Update", timeout: ACTION_TIMEOUT },
    (value) => {
      if (!isRecord(value)) return invalidJob();
      return value.job !== undefined ? parseJob(value.job) : parseUpdateStatus(value.status);
    },
    signal, fetcher, bridge ?? detectShellBridge(),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function invalidJob(): never {
  throw new ApiError("The MSO job response is invalid.", 502);
}
