// Payload shapes and fail-closed parsers for the AppDeck endpoints. Anything the
// host sends that is not exactly the documented contract is refused, so a stale
// or proxied HTML/JSON error page never reaches the UI as if it were app state.
import { ApiError } from "./managed-apps-api.ts";

export type JobKind = "install" | "update" | "uninstall" | "restore";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "interrupted";

export type JobSummary = {
  id: string;
  applicationId: string;
  kind: JobKind;
  argv: string[];
  status: JobStatus;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  error: string | null;
  logOffset: number;
  updatedAt: string;
};

export type PreflightCheck = { id: string; label: string; status: "pass" | "warn" | "fail"; detail: string; fixHint?: string };
export type PreflightReport = {
  appId: string; appName: string; installed: boolean; ready: boolean; summary: string;
  backend: "user-systemd" | "docker" | null; checks: PreflightCheck[]; checkedAt: string;
};

export type AppLogs = { available: boolean; entries: string[] };

export type BackupRecord = {
  id: string; applicationId: string; createdAt: string; source: string;
  reason: "manual" | "pre-update" | "pre-uninstall" | "pre-restore" | "unknown";
  files: number | null; bytes: number | null;
};

export type DiscoveredApp = {
  id: string; name: string; description: string; managedAppId?: string; ownership: string;
  running: boolean; source: string; detectedEndpoint?: string; detectedPath?: string;
  containerName?: string; recommendedAction: string; hint: string;
};
export type DiscoverySnapshot = { checkedAt: string; dockerAvailable: boolean; apps: DiscoveredApp[] };

export type TunnelView = {
  id: string; appId: string; title: string; sshUser: string; sshHost: string; sshPort: number;
  remotePort: number; localPort: number; active: boolean; pid: number | null; localUrl: string; error: string | null;
};
export type TunnelSnapshot = { sshAvailable: boolean; tunnels: TunnelView[] };

export type UpdateChannel = { value: string | null; kind: string | null; available: string[]; switchable: boolean; reason: string | null };
export type UpdateStatus = {
  currentVersion: string | null; latestVersion: string | null; updateAvailable: boolean | null;
  detail: string | null; channel: UpdateChannel; installKind: string | null; checkedAt: string | null; error: string | null;
};

const invalid = (label: string): never => {
  throw new ApiError(`The MSO ${label} response is invalid.`, 502);
};
const rec = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const nonEmpty = (v: unknown): v is string => str(v) && v.trim().length > 0;
const strOrNull = (v: unknown): v is string | null => v === null || str(v);
const numOrNull = (v: unknown): v is number | null => v === null || typeof v === "number";
const KINDS = new Set<string>(["install", "update", "uninstall", "restore"]);
const STATUSES = new Set<string>(["queued", "running", "succeeded", "failed", "interrupted"]);

export function parseJob(value: unknown): JobSummary {
  if (!rec(value) || !nonEmpty(value.id) || !nonEmpty(value.applicationId) || !KINDS.has(value.kind as string)
    || !Array.isArray(value.argv) || !value.argv.every(str) || !STATUSES.has(value.status as string)
    || !nonEmpty(value.startedAt) || !strOrNull(value.endedAt) || !numOrNull(value.exitCode)
    || !strOrNull(value.error) || typeof value.logOffset !== "number" || !nonEmpty(value.updatedAt)) return invalid("job list");
  return {
    id: value.id, applicationId: value.applicationId, kind: value.kind as JobKind, argv: [...value.argv],
    status: value.status as JobStatus, startedAt: value.startedAt, endedAt: value.endedAt,
    exitCode: value.exitCode, error: value.error, logOffset: value.logOffset, updatedAt: value.updatedAt,
  };
}

export function parseJobs(value: unknown): JobSummary[] {
  if (!rec(value) || !Array.isArray(value.jobs)) return invalid("job list");
  return value.jobs.map(parseJob);
}

function parseCheck(value: unknown): PreflightCheck {
  if (!rec(value) || !nonEmpty(value.id) || !nonEmpty(value.label)
    || !["pass", "warn", "fail"].includes(value.status as string) || !str(value.detail)
    || (value.fixHint !== undefined && !str(value.fixHint))) return invalid("preflight");
  return {
    id: value.id, label: value.label, status: value.status as PreflightCheck["status"], detail: value.detail,
    ...(value.fixHint !== undefined ? { fixHint: value.fixHint } : {}),
  };
}

export function parsePreflight(value: unknown): PreflightReport {
  if (!rec(value) || !nonEmpty(value.appId) || !nonEmpty(value.appName) || typeof value.installed !== "boolean"
    || typeof value.ready !== "boolean" || !str(value.summary)
    || (value.backend !== null && value.backend !== "user-systemd" && value.backend !== "docker")
    || !Array.isArray(value.checks) || !nonEmpty(value.checkedAt)) return invalid("preflight");
  return {
    appId: value.appId, appName: value.appName, installed: value.installed, ready: value.ready,
    summary: value.summary, backend: value.backend as PreflightReport["backend"],
    checks: value.checks.map(parseCheck), checkedAt: value.checkedAt,
  };
}

export function parseLogs(value: unknown): AppLogs {
  if (!rec(value) || typeof value.available !== "boolean" || !Array.isArray(value.entries)
    || !value.entries.every(str)) return invalid("app log");
  return { available: value.available, entries: [...value.entries] };
}

function parseBackup(value: unknown): BackupRecord {
  if (!rec(value) || !nonEmpty(value.id) || !nonEmpty(value.applicationId) || !nonEmpty(value.createdAt)
    || !str(value.source) || !str(value.reason) || !numOrNull(value.files) || !numOrNull(value.bytes)) {
    return invalid("backup list");
  }
  return {
    id: value.id, applicationId: value.applicationId, createdAt: value.createdAt, source: value.source,
    reason: value.reason as BackupRecord["reason"], files: value.files, bytes: value.bytes,
  };
}

export function parseBackups(value: unknown): BackupRecord[] {
  if (!rec(value) || !Array.isArray(value.backups)) return invalid("backup list");
  return value.backups.map(parseBackup);
}

function parseDiscovered(value: unknown): DiscoveredApp {
  if (!rec(value) || !nonEmpty(value.id) || !nonEmpty(value.name) || !str(value.description)
    || !str(value.ownership) || typeof value.running !== "boolean" || !str(value.source)
    || !str(value.recommendedAction) || !str(value.hint)
    || (value.managedAppId !== undefined && !str(value.managedAppId))
    || (value.detectedEndpoint !== undefined && !str(value.detectedEndpoint))
    || (value.detectedPath !== undefined && !str(value.detectedPath))) return invalid("local discovery");
  return {
    id: value.id, name: value.name, description: value.description, ownership: value.ownership,
    running: value.running, source: value.source, recommendedAction: value.recommendedAction, hint: value.hint,
    ...(value.managedAppId !== undefined ? { managedAppId: value.managedAppId } : {}),
    ...(value.detectedEndpoint !== undefined ? { detectedEndpoint: value.detectedEndpoint } : {}),
    ...(value.detectedPath !== undefined ? { detectedPath: value.detectedPath } : {}),
    ...(value.containerName !== undefined && str(value.containerName) ? { containerName: value.containerName } : {}),
  };
}

export function parseDiscovery(value: unknown): DiscoverySnapshot {
  if (!rec(value) || !nonEmpty(value.checkedAt) || typeof value.dockerAvailable !== "boolean"
    || !Array.isArray(value.apps)) return invalid("local discovery");
  return { checkedAt: value.checkedAt, dockerAvailable: value.dockerAvailable, apps: value.apps.map(parseDiscovered) };
}

function parseTunnel(value: unknown): TunnelView {
  if (!rec(value) || !nonEmpty(value.id) || !nonEmpty(value.appId) || !str(value.title)
    || !str(value.sshUser) || !str(value.sshHost) || typeof value.sshPort !== "number"
    || typeof value.remotePort !== "number" || typeof value.localPort !== "number"
    || typeof value.active !== "boolean" || !numOrNull(value.pid) || !str(value.localUrl)
    || !strOrNull(value.error)) return invalid("tunnel");
  return {
    id: value.id, appId: value.appId, title: value.title, sshUser: value.sshUser, sshHost: value.sshHost,
    sshPort: value.sshPort, remotePort: value.remotePort, localPort: value.localPort, active: value.active,
    pid: value.pid, localUrl: value.localUrl, error: value.error,
  };
}

export function parseTunnels(value: unknown): TunnelSnapshot {
  if (!rec(value) || typeof value.sshAvailable !== "boolean" || !Array.isArray(value.tunnels)) return invalid("tunnel");
  return { sshAvailable: value.sshAvailable, tunnels: value.tunnels.map(parseTunnel) };
}

function parseChannel(value: unknown): UpdateChannel {
  if (!rec(value) || !strOrNull(value.value) || !strOrNull(value.kind) || !Array.isArray(value.available)
    || !value.available.every(str) || typeof value.switchable !== "boolean" || !strOrNull(value.reason)) {
    return invalid("update status");
  }
  return {
    value: value.value, kind: value.kind, available: [...value.available],
    switchable: value.switchable, reason: value.reason,
  };
}

export function parseUpdateStatus(value: unknown): UpdateStatus {
  if (!rec(value) || !strOrNull(value.currentVersion) || !strOrNull(value.latestVersion)
    || (value.updateAvailable !== null && typeof value.updateAvailable !== "boolean")
    || !strOrNull(value.detail) || !strOrNull(value.installKind) || !strOrNull(value.checkedAt)
    || !strOrNull(value.error)) return invalid("update status");
  return {
    currentVersion: value.currentVersion, latestVersion: value.latestVersion,
    updateAvailable: value.updateAvailable, detail: value.detail, channel: parseChannel(value.channel),
    installKind: value.installKind, checkedAt: value.checkedAt, error: value.error,
  };
}
