import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export { ApiError };
export type { ShellBridge };

export type OrganizationUnitKind = "holding" | "company" | "division" | "team" | "client" | "other";
export type OrganizationStatus = "active" | "inactive";
export type OrganizationSeatMode = "permanent" | "on_demand" | "inactive";
export type OrganizationSeatState = "active" | "vacant" | "inactive";
export type OrganizationTargetKind = "none" | "project-agent" | "local-agent" | "a2a";
export type OrganizationRuntimeStatus = "ready" | "busy" | "offline" | "unresolved" | "unbound" | "vacant";

export type OrganizationTarget =
  | { kind: "none" }
  | { kind: "project-agent"; project: string }
  | { kind: "local-agent"; ref: string }
  | { kind: "a2a"; ref: string };

export type OrganizationUnit = {
  id: string; key: string; name: string; kind: OrganizationUnitKind; status: OrganizationStatus;
  parentUnitId?: string; description?: string; sortOrder: number; createdAt: string; updatedAt: string;
};

export type OrganizationSeat = {
  id: string; unitId: string; name: string; title: string; role: string;
  state: OrganizationSeatState; seatMode: OrganizationSeatMode;
  reportsToSeatId?: string; description?: string; responsibilities: string[];
  target: OrganizationTarget; sortOrder: number; createdAt: string; updatedAt: string;
};

export type OrganizationChart = {
  version: 1; name: string; revision: string; updatedAt: string;
  units: OrganizationUnit[]; seats: OrganizationSeat[];
};

export type OrganizationSeatRuntime = {
  seatId: string; targetKind: OrganizationTargetKind; status: OrganizationRuntimeStatus;
  label?: string; detail?: string;
};

export type OrganizationSnapshot = { chart: OrganizationChart; runtime: OrganizationSeatRuntime[] };

export type OrganizationState =
  | { kind: "loading" }
  | { kind: "ready"; chart: OrganizationChart; runtime: OrganizationSeatRuntime[] }
  | { kind: "error"; message: string; forbidden?: boolean };

const UNIT_KINDS = new Set<OrganizationUnitKind>(["holding", "company", "division", "team", "client", "other"]);
const UNIT_STATUSES = new Set<OrganizationStatus>(["active", "inactive"]);
const SEAT_MODES = new Set<OrganizationSeatMode>(["permanent", "on_demand", "inactive"]);
const SEAT_STATES = new Set<OrganizationSeatState>(["active", "vacant", "inactive"]);
const TARGET_KINDS = new Set<OrganizationTargetKind>(["none", "project-agent", "local-agent", "a2a"]);
const RUNTIME_STATUSES = new Set<OrganizationRuntimeStatus>(["ready", "busy", "offline", "unresolved", "unbound", "vacant"]);

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isOptStr = (v: unknown): v is string | undefined => v === undefined || typeof v === "string";
const invalid = () => new ApiError("The MSO organization response is invalid.", 502);

function statusMessage(status: number): string {
  if (status === 401) return "Your session is unavailable. Sign in and retry.";
  if (status === 403) return "This device does not have permission to view organization data.";
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  if (status === 502 || status === 503) return "Organization service is temporarily unavailable. Retry when ready.";
  return `Organization request failed (${status}).`;
}

function validateTarget(raw: unknown): OrganizationTarget {
  if (!isRecord(raw) || !TARGET_KINDS.has(raw.kind as OrganizationTargetKind)) throw invalid();
  if (raw.kind === "none") return { kind: "none" };
  if (raw.kind === "project-agent") {
    if (!isNonEmpty(raw.project)) throw invalid();
    return { kind: "project-agent", project: raw.project };
  }
  if (!isNonEmpty(raw.ref)) throw invalid();
  return { kind: raw.kind as "local-agent" | "a2a", ref: raw.ref };
}

function validateUnit(raw: unknown): OrganizationUnit {
  if (!isRecord(raw) || !isNonEmpty(raw.id) || !isNonEmpty(raw.key) || !isNonEmpty(raw.name)
      || !UNIT_KINDS.has(raw.kind as OrganizationUnitKind)
      || !UNIT_STATUSES.has(raw.status as OrganizationStatus)
      || typeof raw.sortOrder !== "number" || !Number.isFinite(raw.sortOrder)
      || !isNonEmpty(raw.createdAt) || !isNonEmpty(raw.updatedAt)
      || !isOptStr(raw.parentUnitId) || !isOptStr(raw.description)) {
    throw invalid();
  }
  return {
    id: raw.id, key: raw.key, name: raw.name, kind: raw.kind as OrganizationUnitKind,
    status: raw.status as OrganizationStatus, sortOrder: raw.sortOrder,
    createdAt: raw.createdAt, updatedAt: raw.updatedAt,
    ...(raw.parentUnitId ? { parentUnitId: raw.parentUnitId } : {}),
    ...(raw.description ? { description: raw.description } : {}),
  };
}

function validateSeat(raw: unknown): OrganizationSeat {
  if (!isRecord(raw) || !isNonEmpty(raw.id) || !isNonEmpty(raw.unitId)
      || !isNonEmpty(raw.name) || !isNonEmpty(raw.title) || !isNonEmpty(raw.role)
      || !SEAT_STATES.has(raw.state as OrganizationSeatState)
      || !SEAT_MODES.has(raw.seatMode as OrganizationSeatMode)
      || !Array.isArray(raw.responsibilities) || !raw.responsibilities.every((r) => typeof r === "string")
      || typeof raw.sortOrder !== "number" || !Number.isFinite(raw.sortOrder)
      || !isNonEmpty(raw.createdAt) || !isNonEmpty(raw.updatedAt)
      || !isOptStr(raw.reportsToSeatId) || !isOptStr(raw.description)) {
    throw invalid();
  }
  return {
    id: raw.id, unitId: raw.unitId, name: raw.name, title: raw.title, role: raw.role,
    state: raw.state as OrganizationSeatState, seatMode: raw.seatMode as OrganizationSeatMode,
    responsibilities: raw.responsibilities.map((r) => r.trim()).filter(Boolean),
    target: validateTarget(raw.target), sortOrder: raw.sortOrder,
    createdAt: raw.createdAt, updatedAt: raw.updatedAt,
    ...(raw.reportsToSeatId ? { reportsToSeatId: raw.reportsToSeatId } : {}),
    ...(raw.description ? { description: raw.description } : {}),
  };
}

function validateRuntime(raw: unknown): OrganizationSeatRuntime {
  if (!isRecord(raw) || !isNonEmpty(raw.seatId)
      || !TARGET_KINDS.has(raw.targetKind as OrganizationTargetKind)
      || !RUNTIME_STATUSES.has(raw.status as OrganizationRuntimeStatus)
      || !isOptStr(raw.label) || !isOptStr(raw.detail)) {
    throw invalid();
  }
  return {
    seatId: raw.seatId, targetKind: raw.targetKind as OrganizationTargetKind,
    status: raw.status as OrganizationRuntimeStatus,
    ...(raw.label ? { label: raw.label } : {}),
    ...(raw.detail ? { detail: raw.detail } : {}),
  };
}

function validatePayload(payload: unknown): OrganizationSnapshot {
  if (!isRecord(payload) || !isRecord(payload.chart) || !Array.isArray(payload.runtime)) throw invalid();
  const c = payload.chart;
  if (c.version !== 1 || !isNonEmpty(c.name) || !isNonEmpty(c.revision) || !isNonEmpty(c.updatedAt)
      || !Array.isArray(c.units) || !Array.isArray(c.seats)) {
    throw invalid();
  }
  return {
    chart: {
      version: 1, name: c.name, revision: c.revision, updatedAt: c.updatedAt,
      units: c.units.map(validateUnit), seats: c.seats.map(validateSeat),
    },
    runtime: payload.runtime.map(validateRuntime),
  };
}

export async function readOrganization(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<OrganizationSnapshot> {
  const response = await fetcher(resolveApiUrl("/api/v1/organization", bridge), {
    method: "GET", credentials: bridge.apiBaseOrigin ? "include" : "same-origin", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), headers: { Accept: "application/json" },
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
  let payload: unknown;
  try { payload = await response.json(); } catch { throw invalid(); }
  return validatePayload(payload);
}

export function createOrganizationController(
  update: (next: OrganizationState) => void, fetcher = fetch, bridge?: ShellBridge,
) {
  let generation = 0; let active: AbortController | undefined; let disposed = false;
  return {
    async refresh() {
      if (disposed) return;
      const run = ++generation;
      active?.abort();
      const controller = (active = new AbortController());
      update({ kind: "loading" });
      try {
        const snapshot = await readOrganization(controller.signal, fetcher, bridge);
        if (!disposed && run === generation) update({ kind: "ready", chart: snapshot.chart, runtime: snapshot.runtime });
      } catch (error) {
        if (!disposed && run === generation && !controller.signal.aborted) {
          const forbidden = error instanceof ApiError && error.status === 403;
          update({
            kind: "error",
            message: error instanceof ApiError ? error.message : "Could not load organization chart. Check the backend and retry.",
            ...(forbidden ? { forbidden: true } : {}),
          });
        }
      }
    },
    dispose() { disposed = true; generation++; active?.abort(); },
  };
}
