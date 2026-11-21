import type {
  ServiceAction, ServiceInventory, ServiceScope, SystemService,
} from "../../../../../lib/contracts/os-api";
import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export type { ServiceAction, ServiceInventory, ServiceScope, ShellBridge, SystemService };
export { ApiError };
export type ServiceActionInput = { scope: ServiceScope; unit: string; action: ServiceAction };
export type ServicesState =
  | { kind: "loading" }
  | { kind: "ready"; inventory: ServiceInventory; busyKey: string | null; notice: string | null; actionError: string | null }
  | { kind: "unavailable"; inventory: ServiceInventory; message: string }
  | { kind: "error"; message: string };

const SCOPES = new Set<ServiceScope>(["system", "user"]);
const ACTIONS = new Set<ServiceAction>(["start", "stop", "restart"]);
const UNIT_RE = /^[A-Za-z0-9_][A-Za-z0-9_.@:-]{0,179}\.service$/;
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

export const serviceKey = (scope: ServiceScope, unit: string): string => `${scope}:${unit}`;
export const isSupervisorUnavailable = (inv: ServiceInventory): boolean =>
  inv.services.length === 0 && inv.diagnostics.some((line) => /unavailable/i.test(line));

function statusMessage(status: number, kind: "read" | "action"): string {
  if (status === 401) return "Your session is unavailable or this device no longer has access.";
  if (status === 403) return kind === "action"
    ? "Operator or owner role is required for allowlisted service actions."
    : "Your session is unavailable or this device no longer has access.";
  if (status === 409) return "Service state conflict. Refresh services and retry.";
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  if (status === 400 && kind === "action") return "Service action rejected. Only allowlisted systemd units support start, stop, or restart.";
  return kind === "action" ? `Service action request failed (${status}).` : `Service inventory request failed (${status}).`;
}

function validateService(value: unknown, label: string): SystemService {
  if (!isRecord(value) || typeof value.unit !== "string" || !UNIT_RE.test(value.unit)
      || !SCOPES.has(value.scope as ServiceScope) || typeof value.load !== "string"
      || typeof value.active !== "string" || typeof value.sub !== "string"
      || typeof value.description !== "string" || typeof value.controllable !== "boolean") {
    throw new ApiError(`The MSO ${label} response is invalid.`, 502);
  }
  return {
    unit: value.unit, scope: value.scope as ServiceScope, load: value.load, active: value.active,
    sub: value.sub, description: value.description, controllable: value.controllable,
  };
}

function validateInventory(value: unknown): ServiceInventory {
  if (!isRecord(value) || !Array.isArray(value.services) || !Array.isArray(value.diagnostics)
      || !value.diagnostics.every((line) => typeof line === "string")
      || typeof value.truncated !== "boolean" || typeof value.controlAllowlistConfigured !== "boolean"
      || typeof value.generatedAt !== "string" || value.generatedAt.trim().length === 0) {
    throw new ApiError("The MSO service inventory response is invalid.", 502);
  }
  return {
    services: value.services.map((item) => validateService(item, "service inventory")),
    diagnostics: [...value.diagnostics], truncated: value.truncated,
    controlAllowlistConfigured: value.controlAllowlistConfigured, generatedAt: value.generatedAt,
  };
}

async function requestServices(
  method: "GET" | "POST", signal: AbortSignal, fetcher: typeof fetch, bridge: ShellBridge, payload?: ServiceActionInput,
): Promise<unknown> {
  const kind = method === "GET" ? "read" : "action";
  const headers: Record<string, string> = { Accept: "application/json", ...(payload ? { "Content-Type": "application/json" } : {}) };
  const response = await fetcher(resolveApiUrl("/api/v1/sys/services", bridge), {
    method,
    credentials: bridge.apiBaseOrigin ? "include" : "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(method === "POST" ? 30_000 : 10_000)]),
    headers,
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status, kind), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status, kind), response.status);
  try { return await response.json(); } catch {
    throw new ApiError(`The MSO service ${kind === "read" ? "inventory" : "action"} response is invalid.`, 502);
  }
}

export async function readServices(signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge()): Promise<ServiceInventory> {
  return validateInventory(await requestServices("GET", signal, fetcher, bridge));
}

export async function runServiceAction(
  input: ServiceActionInput, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<SystemService> {
  if (!SCOPES.has(input.scope) || !UNIT_RE.test(input.unit) || !ACTIONS.has(input.action)) throw new ApiError("Invalid service action request.", 400);
  const body: ServiceActionInput = { scope: input.scope, unit: input.unit, action: input.action };
  return validateService(await requestServices("POST", signal, fetcher, bridge, body), "service action");
}

// One owner per mounted list. Refresh/trigger/dispose invalidates older requests even if fetch ignores AbortSignal.
export function createServicesController(update: (state: ServicesState) => void, fetcher = fetch, bridge?: ShellBridge) {
  let generation = 0;
  let active: AbortController | undefined;
  let disposed = false;
  let current: ServiceInventory | null = null;

  function applyInventory(inventory: ServiceInventory, notice: string | null = null) {
    current = inventory;
    update(isSupervisorUnavailable(inventory)
      ? { kind: "unavailable", inventory, message: "Systemd service supervisor is unavailable on this host." }
      : { kind: "ready", inventory, busyKey: null, notice, actionError: null });
  }

  return {
    async refresh() {
      if (disposed) return;
      const run = ++generation;
      active?.abort();
      const controller = (active = new AbortController());
      update({ kind: "loading" });
      try {
        const inventory = await readServices(controller.signal, fetcher, bridge);
        if (disposed || run !== generation) return;
        applyInventory(inventory);
      } catch (error) {
        if (disposed || run !== generation || controller.signal.aborted) return;
        update({ kind: "error", message: error instanceof ApiError ? error.message : "Could not load host services. Check the backend and retry." });
      }
    },
    async trigger(scope: ServiceScope, unit: string, action: ServiceAction) {
      if (disposed || !current) return;
      const run = ++generation;
      active?.abort();
      const controller = (active = new AbortController());
      update({ kind: "ready", inventory: current, busyKey: serviceKey(scope, unit), notice: null, actionError: null });
      try {
        await runServiceAction({ scope, unit, action }, controller.signal, fetcher, bridge);
        if (disposed || run !== generation) return;
        const inventory = await readServices(controller.signal, fetcher, bridge);
        if (disposed || run !== generation) return;
        applyInventory(inventory, `Completed ${action} on ${unit}.`);
      } catch (error) {
        if (disposed || run !== generation || controller.signal.aborted) return;
        update({
          kind: "ready", inventory: current, busyKey: null, notice: null,
          actionError: error instanceof ApiError ? error.message : "Could not complete service action. Retry when reachable.",
        });
      }
    },
    dispose() { disposed = true; generation++; active?.abort(); },
  };
}
