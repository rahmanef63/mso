import { requestJson } from "./settings-request.ts";
import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export { ApiError };
export type { ShellBridge };
export type UpdateChannel = "stable" | "main";
export type UpdateCommit = { sha: string; subject: string; date: string };
export type UpdateConflictReport = {
  conflicted: string[]; carried: string[]; overlap: string[]; safe: boolean; detail: string;
};
export type SoftwareUpdateStatus = {
  supported: boolean; reason: string | null; current: string; currentSubject: string;
  latest?: string; buildSha: string; pendingBuild: boolean; ahead: number; behind: number;
  commits: UpdateCommit[]; dirty: boolean; running: boolean; remoteChecked: boolean; log: string;
  channel?: UpdateChannel; target?: string; targetFallback?: boolean; conflict?: UpdateConflictReport;
};
export type SoftwareUpdateState =
  | { kind: "loading" } | { kind: "ready"; status: SoftwareUpdateStatus } | { kind: "error"; message: string };
export type AuditMeta = Record<string, string | number | boolean>;
export type AuditEntry = {
  ts?: string; action: string; actor?: string | null; ip?: string | null;
  target?: string; ok?: boolean; detail?: string; meta?: AuditMeta;
};
export type AuditLogQuery = { limit?: number; prefix?: string; actor?: string };
export type AuditLogState =
  | { kind: "loading" } | { kind: "ready"; entries: AuditEntry[] } | { kind: "error"; message: string };

const CHANNELS = new Set<UpdateChannel>(["stable", "main"]);
const API_UNAVAILABLE = "MSO API is unavailable. Configure the local backend before retrying.";
const UPDATE_INVALID = "The MSO software update response is invalid.";
const AUDIT_INVALID = "The MSO audit log response is invalid.";
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonNegInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

function statusMessage(status: number, kind: "update" | "audit"): string {
  if (status === 401) return "Your session is unavailable or this device no longer has access.";
  if (status === 403) return kind === "audit" ? "Owner role is required to view the host audit log." : "Owner role is required to inspect software updates.";
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  return kind === "audit" ? `Audit log request failed (${status}).` : `Software update request failed (${status}).`;
}

async function fetchHostJson(
  path: string, kind: "update" | "audit", signal: AbortSignal, fetcher: typeof fetch, bridge: ShellBridge,
): Promise<unknown> {
  const response = await fetcher(resolveApiUrl(path, bridge), {
    method: "GET",
    credentials: bridge.apiBaseOrigin ? "include" : "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    headers: { Accept: "application/json" },
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status, kind), response.status);
    throw new ApiError(API_UNAVAILABLE, 502);
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status, kind), response.status);
  try { return await response.json(); }
  catch { throw new ApiError(kind === "audit" ? AUDIT_INVALID : UPDATE_INVALID, 502); }
}

function parseCommit(raw: unknown): UpdateCommit {
  if (!isRecord(raw) || typeof raw.sha !== "string" || !raw.sha.trim()
      || typeof raw.subject !== "string" || typeof raw.date !== "string") {
    throw new ApiError(UPDATE_INVALID, 502);
  }
  return { sha: raw.sha, subject: raw.subject, date: raw.date };
}

function parseConflict(raw: unknown): UpdateConflictReport {
  if (!isRecord(raw) || !isStringList(raw.conflicted) || !isStringList(raw.carried)
      || !isStringList(raw.overlap) || typeof raw.safe !== "boolean" || typeof raw.detail !== "string") {
    throw new ApiError(UPDATE_INVALID, 502);
  }
  return {
    conflicted: [...raw.conflicted], carried: [...raw.carried],
    overlap: [...raw.overlap], safe: raw.safe, detail: raw.detail,
  };
}

function parseUpdateStatus(v: unknown): SoftwareUpdateStatus {
  if (!isRecord(v) || typeof v.supported !== "boolean" || (v.reason !== null && typeof v.reason !== "string")
      || typeof v.current !== "string" || !v.current.trim() || typeof v.currentSubject !== "string"
      || typeof v.buildSha !== "string" || typeof v.pendingBuild !== "boolean"
      || !isNonNegInt(v.ahead) || !isNonNegInt(v.behind) || !Array.isArray(v.commits)
      || typeof v.dirty !== "boolean" || typeof v.running !== "boolean"
      || typeof v.remoteChecked !== "boolean" || typeof v.log !== "string"
      || (v.latest !== undefined && typeof v.latest !== "string")
      || (v.channel !== undefined && !CHANNELS.has(v.channel as UpdateChannel))
      || (v.target !== undefined && typeof v.target !== "string")
      || (v.targetFallback !== undefined && typeof v.targetFallback !== "boolean")) {
    throw new ApiError(UPDATE_INVALID, 502);
  }
  return {
    supported: v.supported, reason: v.reason, current: v.current, currentSubject: v.currentSubject,
    buildSha: v.buildSha, pendingBuild: v.pendingBuild, ahead: v.ahead, behind: v.behind,
    commits: v.commits.map(parseCommit), dirty: v.dirty, running: v.running,
    remoteChecked: v.remoteChecked, log: v.log,
    ...(v.latest !== undefined ? { latest: v.latest } : {}),
    ...(v.channel !== undefined ? { channel: v.channel as UpdateChannel } : {}),
    ...(v.target !== undefined ? { target: v.target } : {}),
    ...(v.targetFallback !== undefined ? { targetFallback: v.targetFallback } : {}),
    ...(v.conflict !== undefined ? { conflict: parseConflict(v.conflict) } : {}),
  };
}

function parseAuditMeta(raw: unknown): AuditMeta {
  if (!isRecord(raw)) throw new ApiError(AUDIT_INVALID, 502);
  const out: AuditMeta = {};
  for (const [k, val] of Object.entries(raw)) {
    if (typeof val !== "string" && typeof val !== "number" && typeof val !== "boolean") {
      throw new ApiError(AUDIT_INVALID, 502);
    }
    out[k] = val;
  }
  return out;
}

function parseAuditEntry(v: unknown): AuditEntry {
  if (!isRecord(v) || typeof v.action !== "string" || !v.action.trim()
      || (v.ts !== undefined && typeof v.ts !== "string")
      || (v.actor !== undefined && v.actor !== null && typeof v.actor !== "string")
      || (v.ip !== undefined && v.ip !== null && typeof v.ip !== "string")
      || (v.target !== undefined && typeof v.target !== "string")
      || (v.ok !== undefined && typeof v.ok !== "boolean")
      || (v.detail !== undefined && typeof v.detail !== "string")) {
    throw new ApiError(AUDIT_INVALID, 502);
  }
  return {
    action: v.action,
    ...(v.ts !== undefined ? { ts: v.ts } : {}),
    ...(v.actor !== undefined ? { actor: v.actor } : {}),
    ...(v.ip !== undefined ? { ip: v.ip } : {}),
    ...(v.target !== undefined ? { target: v.target } : {}),
    ...(v.ok !== undefined ? { ok: v.ok } : {}),
    ...(v.detail !== undefined ? { detail: v.detail } : {}),
    ...(v.meta !== undefined ? { meta: parseAuditMeta(v.meta) } : {}),
  };
}

export async function readSoftwareUpdate(
  signal: AbortSignal, fetcher: typeof fetch = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<SoftwareUpdateStatus> {
  return parseUpdateStatus(await fetchHostJson("/api/v1/sys/update", "update", signal, fetcher, bridge));
}

export async function requestSoftwareUpdate(
  action: "check" | "update" | "rebuild",
  signal: AbortSignal, fetcher: typeof fetch = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<SoftwareUpdateStatus> {
  const body = action === "check" ? { action } : { rebuildOnly: action === "rebuild" };
  return parseUpdateStatus(await requestJson("/api/v1/sys/update", {
    method: "POST", body, signal, fetcher: (...args) => fetcher(...args), bridge, label: "software update", timeoutMs: 60_000,
  }));
}

export async function readAuditLog(
  signal: AbortSignal, fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(), query: AuditLogQuery = {},
): Promise<AuditEntry[]> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 200) {
      throw new ApiError("Audit log limit must be an integer between 1 and 200.", 400);
    }
    params.set("limit", String(query.limit));
  }
  if (query.prefix?.trim()) params.set("prefix", query.prefix.trim());
  if (query.actor?.trim()) params.set("actor", query.actor.trim());
  const qs = params.toString();
  const raw = await fetchHostJson(qs ? `/api/v1/sys/audit?${qs}` : "/api/v1/sys/audit", "audit", signal, fetcher, bridge);
  if (!isRecord(raw) || !Array.isArray(raw.entries)) throw new ApiError(AUDIT_INVALID, 502);
  return raw.entries.map(parseAuditEntry);
}

function createReadController<T, Q = void>(
  load: (signal: AbortSignal, query: Q) => Promise<T>,
  onState: (next: { kind: "loading" } | { kind: "ready"; data: T } | { kind: "error"; message: string }) => void,
  fallbackError: string,
) {
  let gen = 0, active: AbortController | undefined, disposed = false;
  return {
    async refresh(query?: Q) {
      if (disposed) return;
      const run = ++gen; active?.abort(); const ctrl = (active = new AbortController());
      onState({ kind: "loading" });
      try {
        const data = await load(ctrl.signal, query as Q);
        if (!disposed && run === gen && !ctrl.signal.aborted) onState({ kind: "ready", data });
      } catch (e) {
        if (!disposed && run === gen && !ctrl.signal.aborted) {
          onState({ kind: "error", message: e instanceof ApiError ? e.message : fallbackError });
        }
      }
    },
    dispose() { disposed = true; gen++; active?.abort(); },
  };
}

export const createSoftwareUpdateController = (
  update: (state: SoftwareUpdateState) => void, fetcher: typeof fetch = fetch, bridge?: ShellBridge,
) => createReadController(
  (signal) => readSoftwareUpdate(signal, fetcher, bridge),
  (s) => update(s.kind === "ready" ? { kind: "ready", status: s.data } : s),
  "Could not load software update status. Check the backend and retry.",
);

export const createAuditLogController = (
  update: (state: AuditLogState) => void, fetcher: typeof fetch = fetch, bridge?: ShellBridge,
) => createReadController<AuditEntry[], AuditLogQuery | undefined>(
  (signal, query) => readAuditLog(signal, fetcher, bridge, query),
  (s) => update(s.kind === "ready" ? { kind: "ready", entries: s.data } : s),
  "Could not load the host audit log. Check the backend and retry.",
);
