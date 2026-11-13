import type { SysStats } from "../../../../lib/contracts/os-api";

export type Session = {
  authenticated: boolean;
  deviceId: string | null;
  deviceLabel: string | null;
  role: "viewer" | "operator" | "owner" | null;
};
export type { SysStats };
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function readJson(path: string, signal: AbortSignal, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(path, {
    method: "GET", credentials: "same-origin", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new ApiError(response.status === 401 || response.status === 403
      ? "Your session is unavailable or this device no longer has access."
      : `MSO API request failed (${response.status}).`, response.status);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  return response.json();
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function nullableString(value: unknown): boolean { return value === null || typeof value === "string"; }
function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export async function readSession(signal: AbortSignal, fetcher = fetch): Promise<Session> {
  const value = await readJson("/api/auth/me", signal, fetcher);
  if (!record(value) || typeof value.authenticated !== "boolean"
      || !nullableString(value.deviceId) || !nullableString(value.deviceLabel)
      || ![null, "viewer", "operator", "owner"].includes(value.role as Session["role"])
      || (value.authenticated && (typeof value.deviceId !== "string" || value.role === null))
      || (!value.authenticated && (value.deviceId !== null || value.deviceLabel !== null || value.role !== null))) {
    throw new ApiError("The MSO session response is invalid.", 502);
  }
  return value as Session;
}

export async function readStats(signal: AbortSignal, fetcher = fetch): Promise<SysStats> {
  const value = await readJson("/api/v1/sys/stats", signal, fetcher);
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
