// The one module that knows the update-centre wire format, so a route-shape
// change is a one-file edit. Parsed defensively throughout: a field the routes
// do not send lands as null, never as `undefined` rendered "undefined".
import type { ManagedAppId, ManagedAppJobStatus } from "@/lib/managed-apps/types";

const BASE = "/api/v1/managed-apps";

/** Mirrors `ManagedAppChannel`: a branch is not a channel, and `switchable` is
 *  the server's word on whether MSO will move it at all. */
export interface UpdateChannel {
  value: string | null; kind: "channel" | "branch" | null;
  available: string[]; switchable: boolean; reason: string | null;
}

/** Server-declared support, when the route sends it. Absent = the per-app
 *  defaults in `app-support.ts`, which are pinned to the real CLIs' `--help`.
 *  The two commands are what to SHOW when a flow has no non-interactive form. */
export interface UpdateCapabilities {
  check: boolean; apply: boolean; dryRun: boolean; channel: boolean; rollback: boolean; uninstall: boolean;
  installCommand: string | null; uninstallCommand: string | null;
}

export interface UpdateStatus {
  currentVersion: string | null; latestVersion: string | null; installKind: string | null;
  checkedAt: string | null; capabilities: Partial<UpdateCapabilities> | null;
  /** null = never checked / the CLI would not say. Not the same as `false`. */
  updateAvailable: boolean | null;
  /** The upstream one-liner, redacted — what the CLI actually said. */
  detail: string | null;
  channel: UpdateChannel | null;
  /** Set when the probe itself failed; the version fields are then null. */
  error: string | null;
}

export interface JobView {
  /** `applicationId` is null when the route omits it — never assumed to be
   *  ours: adopting a job means adopting its transcript (see start-action.ts). */
  id: string; applicationId: string | null; kind: string; status: ManagedAppJobStatus;
  exitCode: number | null; error: string | null;
  startedAt: string | null; endedAt: string | null;
  /** Only the chars after the `since` cursor that was sent. */
  log: string;
  /** Total chars ever appended; 0 when the route omits it (then the client
   *  advances its own cursor by what it received). */
  logOffset: number;
}

export interface BackupEntry {
  id: string; createdAt: string | null; sizeBytes: number | null; source: string | null; files: number | null;
  /** manual | pre-update | pre-uninstall | pre-restore — which snapshot to roll
   *  back to is mostly a question of what it was taken before. */
  reason: string | null;
  /** What this snapshot never contained, per its own manifest — i.e. exactly
   *  what restoring it cannot bring back. Per-row, not a constant. */
  skippedDirs: string[]; skippedSymlinks: number | null;
}

/** `supported: false` = the route is absent in this build (404) — NOT "no backups". */
export interface BackupList { supported: boolean; backups: BackupEntry[] }

export interface ActionResult { jobId: string | null; status: UpdateStatus | null }
export interface ApplyOptions { channel?: string; tag?: string; branch?: string; dryRun?: boolean; noRestart?: boolean }

export class UpdateApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "UpdateApiError"; }
}

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const rec = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? value as Record<string, unknown> : {});

// 409 is the manager's own operation lock — a job holds the same one as
// start/stop/restart/backup — so it means "wait", not "broken".
const STATUS_HINT: Record<number, string> = {
  409: "another operation is already running",
  429: "rate limited; wait a minute and retry",
  403: "not available in demo mode",
  401: "session expired; sign in again",
};

const messageFor = (status: number, fromBody: string | null): string => fromBody ?? STATUS_HINT[status] ?? `request failed (${status})`;

async function request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE}${path}`, { cache: "no-store", ...init });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new UpdateApiError(messageFor(response.status, str(rec(body).error)), response.status);
  return rec(body);
}

export function toStatus(raw: unknown): UpdateStatus {
  const value = rec(raw);
  const channel = rec(value.channel);
  const available = Array.isArray(channel.available) ? channel.available.filter((c): c is string => typeof c === "string") : [];
  const kind = channel.kind === "channel" || channel.kind === "branch" ? channel.kind : null;
  const named = str(channel.value);
  return {
    currentVersion: str(value.currentVersion),
    latestVersion: str(value.latestVersion),
    updateAvailable: typeof value.updateAvailable === "boolean" ? value.updateAvailable : null,
    detail: str(value.detail),
    // Hermes names a BRANCH it cannot switch and OpenClaw a switchable channel;
    // both arrive here, and `switchable` alone decides whether a control shows.
    channel: named || kind || available.length
      ? { value: named, kind, available, switchable: channel.switchable === true, reason: str(channel.reason) }
      : null,
    installKind: str(value.installKind),
    checkedAt: str(value.checkedAt),
    capabilities: value.capabilities ? rec(value.capabilities) as Partial<UpdateCapabilities> : null,
    error: str(value.error),
  };
}

export function toJob(raw: unknown, fallbackId: string): JobView | null {
  const value = rec(raw);
  const id = str(value.id) ?? str(value.jobId) ?? (fallbackId || null);
  const status = str(value.status);
  if (!id || !status) return null;
  return {
    id, status: status as ManagedAppJobStatus, kind: str(value.kind) ?? "update",
    applicationId: str(value.applicationId), exitCode: num(value.exitCode), error: str(value.error),
    log: typeof value.log === "string" ? value.log : "",
    logOffset: num(value.logOffset) ?? 0,
    startedAt: str(value.startedAt), endedAt: str(value.endedAt),
  };
}

function toBackup(raw: unknown): BackupEntry | null {
  const value = rec(raw);
  const id = str(value.id) ?? str(value.name) ?? str(value.stamp) ?? str(value.createdAt);
  if (!id) return null;
  const skipped = rec(value.skipped);
  return {
    id, createdAt: str(value.createdAt) ?? str(value.stamp),
    sizeBytes: num(value.sizeBytes) ?? num(value.bytes) ?? num(value.size),
    source: str(value.source) ?? str(value.path),
    reason: str(value.reason), files: num(value.files),
    skippedDirs: Array.isArray(skipped.dirNames) ? skipped.dirNames.filter((d): d is string => typeof d === "string") : [],
    skippedSymlinks: num(skipped.symlinks),
  };
}

export const getUpdateStatus = (appId: ManagedAppId, signal?: AbortSignal) => request(`/${appId}/update`, { signal }).then(toStatus);

async function post(appId: ManagedAppId, body: Record<string, unknown>): Promise<ActionResult> {
  const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const raw = await request(`/${appId}/update`, init);
  const jobId = str(raw.jobId) ?? str(rec(raw.job).id);
  if (jobId) return { jobId, status: null };
  // Long-running actions answer with a job id; `check` answers inline, bare or
  // wrapped. An all-null parse means the body was something else entirely —
  // never clobber a good status with it.
  const status = toStatus(raw.status ?? raw.update ?? raw);
  return { jobId: null, status: hasStatusData(status) ? status : null };
}

/** Did the server say anything at all? Stops a `{ok:true}` body parsing into an
 *  all-null status and blanking the panel. */
export const hasStatusData = (s: UpdateStatus): boolean =>
  [s.currentVersion, s.latestVersion, s.updateAvailable, s.channel, s.checkedAt, s.detail, s.error].some((v) => v !== null);

/** The probe. It is a POST because it SPAWNS the app's CLI (and git-fetches, for
 *  Hermes); `GET /update` only ever serves what a previous probe cached. */
export const checkForUpdate = (appId: ManagedAppId) => post(appId, { action: "check" });
export const applyUpdate = (appId: ManagedAppId, options: ApplyOptions = {}) => post(appId, { action: "apply", ...options });
export const switchChannel = (appId: ManagedAppId, channel: string) => post(appId, { action: "channel", channel });
export const rollbackTo = (appId: ManagedAppId, backupId: string, pin?: string) => post(appId, { action: "rollback", backupId, ...(pin ? { pin } : {}) });
/** `confirm` must be the app id typed by the operator — the route rejects it
 *  otherwise. `dryRun` previews the removal; it writes nothing, so no pre-backup. */
export const uninstallApp = (appId: ManagedAppId, confirm: string, dryRun = false) =>
  post(appId, { action: "uninstall", confirm, ...(dryRun ? { dryRun: true } : {}) });

export interface InstallRequest {
  provider?: string;
  /** Optional. Omitted = install with no provider wired; the app starts and says
   *  so, and the same panel can supply one afterwards. */
  apiKey?: string;
  bind?: string;
}

/** Its own route, not `post()` — that helper is hard-wired to `/update`, and an
 *  install has no `action` discriminator to add. Always a job: there is no
 *  inline variant, because nothing about installing finishes inside a request.
 *
 *  `apiKey` is the only credential this client ever sends. It goes in the body
 *  (never a query string, which is logged) and is not kept afterwards — the
 *  caller drops it as soon as this resolves. */
export async function installApp(appId: ManagedAppId, options: InstallRequest = {}): Promise<ActionResult> {
  const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options) };
  const raw = await request(`/${appId}/install`, init);
  return { jobId: str(raw.jobId) ?? str(rec(raw.job).id), status: null };
}

/** null = 404: the record is gone (pruned, or never existed). */
export async function getJob(appId: ManagedAppId, jobId: string, since = 0): Promise<JobView | null> {
  try {
    const raw = await request(`/${appId}/jobs/${encodeURIComponent(jobId)}?since=${since}`);
    return toJob(raw.job ?? raw, jobId);
  } catch (cause) {
    if (cause instanceof UpdateApiError && cause.status === 404) return null;
    throw cause;
  }
}

/** The way out of a wedged operation: a job holds the app's lock until it reaches
 *  a terminal status, so one that never finishes makes every later action on that
 *  app answer 409. false = there was nothing cancellable (404). */
export async function cancelJob(appId: ManagedAppId, jobId: string): Promise<boolean> {
  try {
    await request(`/${appId}/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
    return true;
  } catch (cause) {
    if (cause instanceof UpdateApiError && cause.status === 404) return false;
    throw cause;
  }
}

export async function listJobs(appId: ManagedAppId): Promise<JobView[]> {
  const rows = (await request(`/${appId}/jobs`)).jobs;
  return (Array.isArray(rows) ? rows : []).map((row) => toJob(row, "")).filter((job): job is JobView => job !== null);
}

export async function listBackups(appId: ManagedAppId): Promise<BackupList> {
  try {
    const rows = (await request(`/${appId}/backups`)).backups;
    const backups = (Array.isArray(rows) ? rows : []).map(toBackup);
    return { supported: true, backups: backups.filter((entry): entry is BackupEntry => entry !== null) };
  } catch (cause) {
    if (cause instanceof UpdateApiError && cause.status === 404) return { supported: false, backups: [] };
    throw cause;
  }
}

export const apiMessage = (cause: unknown): string =>
  cause instanceof Error && cause.message ? cause.message : "request failed";
