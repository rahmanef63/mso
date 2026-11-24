import { ApiError, type OrganizationChart, type OrganizationSeat, type OrganizationUnit } from "./org-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export type OrganizationMutation =
  | { action: "unit_upsert"; unit: Record<string, unknown> }
  | { action: "unit_delete"; id: string }
  | { action: "seat_upsert"; seat: Record<string, unknown> }
  | { action: "seat_delete"; id: string };

const KNOWN_CODES: Record<string, string> = {
  operator_required: "Operator role is required to change the organization chart.",
  owner_required: "Owner role is required to replace the organization chart.",
  rate_limited: "Too many requests. Wait a moment and retry.",
};

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function statusMessage(status: number, body?: unknown): string {
  const code = isRecord(body) && typeof body.error === "string" ? body.error : "";
  if (status === 401) return "Your session is unavailable. Sign in and retry.";
  if (status === 403) return KNOWN_CODES.operator_required;
  if (status === 409) return "The organization chart changed on another device. Reload and retry your edit.";
  if (status === 429) return KNOWN_CODES.rate_limited;
  if (code && KNOWN_CODES[code]) return KNOWN_CODES[code];
  if (status === 400 && code) return code;
  return `Organization change failed (${status}).`;
}

/** The API returns the mutated chart; runtime seats are re-read by the caller after the write. */
export async function mutateOrganization(
  mutation: OrganizationMutation, expectedRevision: string, signal: AbortSignal,
  fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<OrganizationChart> {
  const revision = expectedRevision.trim();
  if (!revision) throw new ApiError("Reload the organization chart before editing.", 400);
  const response = await fetcher(resolveApiUrl("/api/v1/organization", bridge), {
    method: "POST",
    credentials: bridge.apiBaseOrigin ? "include" : "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ ...mutation, expected_revision: revision }),
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  let payload: unknown;
  try { payload = await response.json(); } catch {
    if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
    throw new ApiError("The MSO organization response is invalid.", 502);
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status, payload), response.status);
  if (!isRecord(payload) || !isRecord(payload.chart)) {
    throw new ApiError("The MSO organization response is invalid.", 502);
  }
  return payload.chart as OrganizationChart;
}

export type UnitDraft = {
  id?: string; key: string; name: string; kind: OrganizationUnit["kind"];
  status: OrganizationUnit["status"]; parentUnitId: string; description: string; sortOrder: number;
};

export type SeatDraft = {
  id?: string; unitId: string; name: string; title: string; role: string;
  state: OrganizationSeat["state"]; seatMode: OrganizationSeat["seatMode"];
  reportsToSeatId: string; description: string; responsibilities: string;
  targetKind: OrganizationSeat["target"]["kind"]; targetRef: string; sortOrder: number;
};

export function emptyUnitDraft(parentUnitId = ""): UnitDraft {
  return { key: "", name: "", kind: "team", status: "active", parentUnitId, description: "", sortOrder: 0 };
}

export function emptySeatDraft(unitId = ""): SeatDraft {
  return {
    unitId, name: "", title: "", role: "", state: "active", seatMode: "permanent",
    reportsToSeatId: "", description: "", responsibilities: "",
    targetKind: "none", targetRef: "", sortOrder: 0,
  };
}

export function unitDraftFrom(unit: OrganizationUnit): UnitDraft {
  return {
    id: unit.id, key: unit.key, name: unit.name, kind: unit.kind, status: unit.status,
    parentUnitId: unit.parentUnitId ?? "", description: unit.description ?? "", sortOrder: unit.sortOrder,
  };
}

export function seatDraftFrom(seat: OrganizationSeat): SeatDraft {
  return {
    id: seat.id, unitId: seat.unitId, name: seat.name, title: seat.title, role: seat.role,
    state: seat.state, seatMode: seat.seatMode, reportsToSeatId: seat.reportsToSeatId ?? "",
    description: seat.description ?? "", responsibilities: seat.responsibilities.join("\n"),
    targetKind: seat.target.kind,
    targetRef: seat.target.kind === "project-agent" ? seat.target.project
      : seat.target.kind === "none" ? "" : seat.target.ref,
    sortOrder: seat.sortOrder,
  };
}

export function draftTarget(draft: SeatDraft): OrganizationSeat["target"] {
  const ref = draft.targetRef.trim();
  if (draft.targetKind === "none") return { kind: "none" };
  if (draft.targetKind === "project-agent") return { kind: "project-agent", project: ref };
  return { kind: draft.targetKind, ref };
}

/** Returns the first validation message, or null when the draft may be submitted. */
export function validateUnitDraft(draft: UnitDraft): string | null {
  if (!draft.name.trim()) return "Enter a unit name.";
  if (!draft.key.trim()) return "Enter a unit key.";
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(draft.key.trim().toLowerCase())) {
    return "Unit key may use lowercase letters, digits, dots, underscores, and dashes.";
  }
  return null;
}

export function validateSeatDraft(draft: SeatDraft): string | null {
  if (!draft.unitId) return "Choose the unit this seat belongs to.";
  if (!draft.name.trim()) return "Enter a seat name.";
  if (!draft.title.trim()) return "Enter a seat title.";
  if (!draft.role.trim()) return "Enter the seat role.";
  if (draft.targetKind !== "none" && !draft.targetRef.trim()) {
    return draft.targetKind === "project-agent"
      ? "Enter the project this seat executes against."
      : "Enter the agent reference this seat executes against.";
  }
  return null;
}
