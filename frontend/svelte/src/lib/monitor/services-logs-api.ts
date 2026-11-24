import type { ServiceLogs } from "../../../../../lib/contracts/os-api";
import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

const UNIT_RE = /^[A-Za-z0-9_][A-Za-z0-9_.@:-]{0,179}\.service$/;
const SCOPES = new Set(["system", "user"]);
/** Server clamps to 200 lines (`MAX_LOG_LINES`); ask for the bounded maximum only. */
export const LOG_LIMIT = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateLogs(value: unknown): ServiceLogs {
  if (!isRecord(value) || typeof value.unit !== "string" || typeof value.scope !== "string"
      || !Array.isArray(value.entries) || !value.entries.every((line) => typeof line === "string")
      || typeof value.available !== "boolean"
      || (value.diagnostic !== undefined && typeof value.diagnostic !== "string")) {
    throw new ApiError("The MSO service journal response is invalid.", 502);
  }
  return {
    unit: value.unit, scope: value.scope as ServiceLogs["scope"], entries: [...value.entries],
    available: value.available, ...(value.diagnostic ? { diagnostic: value.diagnostic } : {}),
  };
}

function logStatusMessage(status: number): string {
  if (status === 401) return "Your session is unavailable or this device no longer has access.";
  if (status === 403) return "Operator or owner role is required to read service journal logs.";
  if (status === 429) return "Too many service log requests. Wait a moment and retry.";
  return `Service journal request failed (${status}).`;
}

export async function readServiceLogs(
  scope: ServiceLogs["scope"],
  unit: string,
  signal: AbortSignal,
  fetcher = fetch,
  bridge: ShellBridge = detectShellBridge(),
  limit: number = LOG_LIMIT,
): Promise<ServiceLogs> {
  if (!SCOPES.has(scope) || !UNIT_RE.test(unit)) throw new ApiError("Invalid service journal request.", 400);
  const bounded = Math.min(Math.max(Math.floor(limit) || LOG_LIMIT, 1), LOG_LIMIT);
  const query = new URLSearchParams({ scope, unit, limit: String(bounded) });
  const response = await fetcher(resolveApiUrl(`/api/v1/sys/services/logs?${query.toString()}`, bridge), {
    method: "GET",
    credentials: bridge.apiBaseOrigin ? "include" : "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    headers: { Accept: "application/json" },
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(logStatusMessage(response.status), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  if (!response.ok) throw new ApiError(logStatusMessage(response.status), response.status);
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new ApiError("The MSO service journal response is invalid.", 502);
  }
  return validateLogs(parsed);
}
