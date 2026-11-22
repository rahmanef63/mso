import type { SysStats } from "../../../../lib/contracts/os-api";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "./shell-bridge.ts";

export type DeviceRole = "viewer" | "operator" | "owner";
export type Session = {
  authenticated: boolean;
  deviceId: string | null;
  deviceLabel: string | null;
  role: DeviceRole | null;
};
export type ApprovedDevice = {
  label: string;
  approvedAt: number;
  lastSeen?: number;
  role: DeviceRole;
};
export type PendingDevice = {
  label: string;
  firstSeen: number;
  lastSeen: number;
  ip: string;
  attempts: number;
};
export type DeviceInventory = {
  approved: Record<string, ApprovedDevice>;
  pending: Record<string, PendingDevice>;
};
export type LoginResult =
  | { kind: "ok" }
  | { kind: "pending"; deviceId: string; label: string }
  | { kind: "bad-password" }
  | { kind: "rate-limited" }
  | { kind: "demo-disabled" }
  | { kind: "error"; message: string };

export type { SysStats, ShellBridge };
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

const ROLES = new Set<DeviceRole>(["viewer", "operator", "owner"]);
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function nullableString(value: unknown): boolean { return value === null || typeof value === "string"; }
function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

async function requestJson(
  method: "GET" | "POST",
  path: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
  bridge: ShellBridge = detectShellBridge(),
  payload?: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: string | undefined;
  if (payload !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(payload);
  }
  const response = await fetcher(resolveApiUrl(path, bridge), {
    method,
    credentials: bridge.apiBaseOrigin ? "include" : "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    headers,
    ...(body !== undefined ? { body } : {}),
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) {
      throw new ApiError(response.status === 401 || response.status === 403
        ? "Your session is unavailable or this device no longer has access."
        : `MSO API request failed (${response.status}).`, response.status);
    }
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  const parsed = await response.json();
  return { status: response.status, body: parsed };
}

async function readJson(
  path: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<unknown> {
  const { status, body } = await requestJson("GET", path, signal, fetcher, bridge);
  if (status < 200 || status >= 300) {
    throw new ApiError(status === 401 || status === 403
      ? "Your session is unavailable or this device no longer has access."
      : `MSO API request failed (${status}).`, status);
  }
  return body;
}

export async function readSession(signal: AbortSignal, fetcher = fetch, bridge = detectShellBridge()): Promise<Session> {
  const value = await readJson("/api/auth/me", signal, fetcher, bridge);
  if (!record(value) || typeof value.authenticated !== "boolean"
      || !nullableString(value.deviceId) || !nullableString(value.deviceLabel)
      || (value.role !== null && !ROLES.has(value.role as DeviceRole))
      || (value.authenticated && (typeof value.deviceId !== "string" || value.role === null))
      || (!value.authenticated && (value.deviceId !== null || value.deviceLabel !== null || value.role !== null))) {
    throw new ApiError("The MSO session response is invalid.", 502);
  }
  return value as Session;
}

export async function readStats(signal: AbortSignal, fetcher = fetch, bridge = detectShellBridge()): Promise<SysStats> {
  const value = await readJson("/api/v1/sys/stats", signal, fetcher, bridge);
  if (!record(value) || !record(value.cpu) || !record(value.mem) || !record(value.disk)
      || !nonnegative(value.cpu.pct) || value.cpu.pct > 100
      || !nonnegative(value.cpu.cores) || !Number.isInteger(value.cpu.cores) || value.cpu.cores < 1
      || !nonnegative(value.mem.used) || !nonnegative(value.mem.total)
      || !nonnegative(value.disk.used) || !nonnegative(value.disk.total)
      || !nonnegative(value.uptime)) {
    throw new ApiError("The MSO system stats response is invalid.", 502);
  }
  return value as SysStats;
}

export async function loginWithPassword(
  input: { password: string; deviceId: string; deviceLabel: string },
  signal: AbortSignal,
  fetcher = fetch,
  bridge = detectShellBridge(),
): Promise<LoginResult> {
  const { status, body } = await requestJson("POST", "/api/auth/login", signal, fetcher, bridge, input);
  const bodyRec = record(body) ? body : null;
  if (status === 200 && bodyRec?.success === true) return { kind: "ok" };
  const err = typeof bodyRec?.error === "string" ? bodyRec.error : "";
  if (status === 401 && err === "bad_password") return { kind: "bad-password" };
  if (status === 429) return { kind: "rate-limited" };
  if (status === 403 && err === "login_disabled_in_demo") return { kind: "demo-disabled" };
  if (status === 403 && err === "device_pending") {
    return {
      kind: "pending",
      deviceId: typeof bodyRec?.deviceId === "string" ? bodyRec.deviceId : input.deviceId,
      label: typeof bodyRec?.label === "string" ? bodyRec.label : input.deviceLabel,
    };
  }
  return { kind: "error", message: status === 403 ? "Request blocked by origin policy." : `Sign-in failed (${status}).` };
}

export async function logoutSession(signal: AbortSignal, fetcher = fetch, bridge = detectShellBridge()): Promise<void> {
  const { status } = await requestJson("POST", "/api/auth/logout", signal, fetcher, bridge);
  if (status < 200 || status >= 300) throw new ApiError(`Sign-out failed (${status}).`, status);
}

function validateInventory(value: unknown): DeviceInventory {
  if (!record(value) || !record(value.approved) || !record(value.pending)) {
    throw new ApiError("The MSO devices response is invalid.", 502);
  }
  const approved: Record<string, ApprovedDevice> = {};
  for (const [id, raw] of Object.entries(value.approved)) {
    if (!record(raw) || typeof raw.label !== "string" || !nonnegative(raw.approvedAt) || !ROLES.has(raw.role as DeviceRole)) {
      throw new ApiError("The MSO devices response is invalid.", 502);
    }
    approved[id] = {
      label: raw.label,
      approvedAt: raw.approvedAt,
      role: raw.role as DeviceRole,
      ...(nonnegative(raw.lastSeen) ? { lastSeen: raw.lastSeen } : {}),
    };
  }
  const pending: Record<string, PendingDevice> = {};
  for (const [id, raw] of Object.entries(value.pending)) {
    if (!record(raw) || typeof raw.label !== "string" || !nonnegative(raw.firstSeen) || !nonnegative(raw.lastSeen)
        || typeof raw.ip !== "string" || !nonnegative(raw.attempts)) {
      throw new ApiError("The MSO devices response is invalid.", 502);
    }
    pending[id] = { label: raw.label, firstSeen: raw.firstSeen, lastSeen: raw.lastSeen, ip: raw.ip, attempts: raw.attempts };
  }
  return { approved, pending };
}

export async function readDevices(signal: AbortSignal, fetcher = fetch, bridge = detectShellBridge()): Promise<DeviceInventory> {
  return validateInventory(await readJson("/api/auth/devices", signal, fetcher, bridge));
}

export async function mutateDevice(
  input: { action: "approve" | "set_role" | "revoke"; deviceId: string; label?: string; role?: DeviceRole },
  signal: AbortSignal,
  fetcher = fetch,
  bridge = detectShellBridge(),
): Promise<DeviceInventory> {
  const { status, body } = await requestJson("POST", "/api/auth/devices", signal, fetcher, bridge, input);
  if (status >= 200 && status < 300) return validateInventory(body);
  if (status === 403) throw new ApiError("Owner role is required to manage devices.", 403);
  if (status === 409) throw new ApiError("Cannot modify or demote this device from its own session.", 409);
  if (status === 503) throw new ApiError("Device was revoked, but browser session teardown needs retry.", 503);
  throw new ApiError(`Device update failed (${status}).`, status);
}
