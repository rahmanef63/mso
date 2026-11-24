import { ApiError } from "../host-api.ts";
import { detectShellBridge } from "../shell-bridge.ts";
import type { ShellBridge } from "../shell-bridge.ts";
import { isRecord, requestJson } from "./settings-request.ts";

// ---------------------------------------------------------------------------
// System & Maintenance (Cleanup, Federation, Update Automation)
// ---------------------------------------------------------------------------

export type * from "./settings-sys-types.ts";
import type {
  CleanupItem, CleanupPreview, CleanupRunResult, FederationStatus, UpdateAutomationView,
} from "./settings-sys-types.ts";

export async function readCleanupPreview(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<CleanupPreview> {
  const raw = await requestJson("/api/v1/sys/cleanup", {
    label: "storage cleanup preview",
    timeoutMs: 30_000,
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || !Array.isArray(raw.items) || !isRecord(raw.preview) || typeof raw.preview.id !== "string") {
    throw new ApiError("The storage cleanup preview response is invalid.", 502);
  }
  const items: CleanupItem[] = raw.items.flatMap((row): CleanupItem[] => {
    if (!isRecord(row) || typeof row.id !== "string") return [];
    return [{
      id: row.id,
      label: typeof row.label === "string" ? row.label : row.id,
      desc: typeof row.desc === "string" ? row.desc : "",
      bytes: typeof row.bytes === "number" && Number.isFinite(row.bytes) ? row.bytes : 0,
      available: Boolean(row.available),
    }];
  });
  return {
    items,
    previewId: raw.preview.id,
    expiresAt: typeof raw.preview.expiresAt === "string" ? raw.preview.expiresAt : "",
    protectedTargets: Array.isArray(raw.protected)
      ? raw.protected.filter((p): p is string => typeof p === "string")
      : [],
  };
}

export async function runCleanupSelection(
  previewId: string,
  ids: string[],
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<CleanupRunResult[]> {
  const raw = await requestJson("/api/v1/sys/cleanup", {
    method: "POST",
    body: { ids, preview_id: previewId, confirm: true },
    label: "storage cleanup",
    timeoutMs: 60_000,
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || !Array.isArray(raw.results)) {
    throw new ApiError("The storage cleanup response is invalid.", 502);
  }
  return raw.results.flatMap((row): CleanupRunResult[] => {
    if (!isRecord(row) || typeof row.id !== "string") return [];
    return [{
      id: row.id,
      ok: Boolean(row.ok),
      freedBytes: typeof row.freedBytes === "number" ? row.freedBytes : 0,
      ...(typeof row.error === "string" ? { error: row.error } : {}),
    }];
  });
}

export async function readFederationStatus(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<FederationStatus> {
  const raw = await requestJson("/api/v1/federation/status", {
    label: "federation status",
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || typeof raw.running !== "boolean" || typeof raw.connected !== "boolean") {
    throw new ApiError("The federation status response is invalid.", 502);
  }
  const outcome =
    raw.lastOutcome === "idle" || raw.lastOutcome === "succeeded" || raw.lastOutcome === "failed"
      ? raw.lastOutcome
      : undefined;
  return {
    running: raw.running,
    connected: raw.connected,
    ...(typeof raw.lastPollAt === "number" ? { lastPollAt: raw.lastPollAt } : {}),
    ...(typeof raw.lastHeartbeatAt === "number" ? { lastHeartbeatAt: raw.lastHeartbeatAt } : {}),
    ...(typeof raw.lastSuccessAt === "number" ? { lastSuccessAt: raw.lastSuccessAt } : {}),
    ...(typeof raw.lastError === "string" ? { lastError: raw.lastError } : {}),
    ...(typeof raw.currentRequestId === "string" ? { currentRequestId: raw.currentRequestId } : {}),
    ...(typeof raw.lastRequestId === "string" ? { lastRequestId: raw.lastRequestId } : {}),
    ...(outcome ? { lastOutcome: outcome } : {}),
    consecutiveFailures: typeof raw.consecutiveFailures === "number" ? raw.consecutiveFailures : 0,
    ...(typeof raw.nextPollInMs === "number" ? { nextPollInMs: raw.nextPollInMs } : {}),
    ...(typeof raw.batonProject === "string" ? { batonProject: raw.batonProject } : {}),
    msoToolCount: typeof raw.msoToolCount === "number" ? raw.msoToolCount : 0,
    ...(typeof raw.siCoderFunctionCount === "number" ? { siCoderFunctionCount: raw.siCoderFunctionCount } : {}),
    ...(typeof raw.siCoderVersion === "string" ? { siCoderVersion: raw.siCoderVersion } : {}),
  };
}

function parseUpdateAutomation(raw: unknown): UpdateAutomationView {
  if (!isRecord(raw) || !isRecord(raw.prefs) || !isRecord(raw.timer)) {
    throw new ApiError("The update automation response is invalid.", 502);
  }
  const lastRaw = isRecord(raw.last) ? raw.last : {};
  const lastResult =
    lastRaw.lastResult === "ok" || lastRaw.lastResult === "failed" || lastRaw.lastResult === "skipped"
      ? lastRaw.lastResult
      : null;
  const lastChannel = lastRaw.channel === "main" || lastRaw.channel === "stable" ? lastRaw.channel : null;
  return {
    prefs: {
      auto: Boolean(raw.prefs.auto),
      channel: raw.prefs.channel === "main" ? "main" : "stable",
    },
    timer: {
      installed: Boolean(raw.timer.installed),
      enabled: Boolean(raw.timer.enabled),
      active: Boolean(raw.timer.active),
      nextRun: typeof raw.timer.nextRun === "string" ? raw.timer.nextRun : null,
    },
    active: Boolean(raw.active),
    last: {
      lastAttemptAt: typeof lastRaw.lastAttemptAt === "number" ? lastRaw.lastAttemptAt : null,
      lastResult,
      consecutiveFailures: typeof lastRaw.consecutiveFailures === "number" ? lastRaw.consecutiveFailures : 0,
      detail: typeof lastRaw.detail === "string" ? lastRaw.detail : null,
      channel: lastChannel,
    },
    drift: typeof raw.drift === "string" ? raw.drift : null,
    supported: raw.supported !== false,
    reason: typeof raw.reason === "string" ? raw.reason : null,
  };
}

export async function readUpdateAutomation(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<UpdateAutomationView> {
  const raw = await requestJson("/api/v1/sys/update/automation", {
    label: "update automation",
    signal,
    fetcher,
    bridge,
  });
  return parseUpdateAutomation(raw);
}

export async function saveUpdateAutomation(
  patch: { auto?: boolean; channel?: "stable" | "main" },
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<UpdateAutomationView> {
  const raw = await requestJson("/api/v1/sys/update/automation", {
    method: "POST",
    body: { updates: patch },
    label: "update automation",
    timeoutMs: 30_000,
    signal,
    fetcher,
    bridge,
  });
  return parseUpdateAutomation(raw);
}
