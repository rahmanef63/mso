import { parseOrganizationFlow } from "./organization-flow-schema";
import type {
  OrganizationChart,
  OrganizationSeat,
  OrganizationSeatMode,
  OrganizationSeatState,
  OrganizationTarget,
  OrganizationUnit,
  OrganizationUnitKind,
} from "@/lib/contracts/organization";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const UNIT_KINDS = new Set<OrganizationUnitKind>(["holding", "company", "division", "team", "client", "other"]);
const SEAT_MODES = new Set<OrganizationSeatMode>(["permanent", "on_demand", "inactive"]);
const SEAT_STATES = new Set<OrganizationSeatState>(["active", "vacant", "inactive"]);
const text = (v: unknown, max = 160) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const required = (v: unknown, field: string, max = 160) => { const out = text(v, max); if (!out) throw new Error(`${field} is required`); return out; };
const id = (v: unknown, field: string) => { const out = required(v, field, 128); if (!ID.test(out)) throw new Error(`${field} is invalid`); return out; };
const order = (v: unknown) => Number.isFinite(Number(v)) ? Math.max(-10000, Math.min(10000, Math.trunc(Number(v)))) : 0;

function target(v: unknown): OrganizationTarget {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { kind: "none" };
  const row = v as Record<string, unknown>, kind = String(row.kind || "none");
  if (kind === "none") return { kind: "none" };
  if (kind === "project-agent") return { kind, project: required(row.project, "target.project", 4096) };
  if (kind === "local-agent" || kind === "a2a") return { kind, ref: required(row.ref, "target.ref", 4096) };
  throw new Error("organization target kind is invalid");
}

export function parseOrganizationUnit(v: unknown, now = new Date().toISOString()): OrganizationUnit {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("organization unit must be an object");
  const row = v as Partial<OrganizationUnit>, kind = String(row.kind || "other") as OrganizationUnitKind;
  if (!UNIT_KINDS.has(kind)) throw new Error("organization unit kind is invalid");
  const key = required(row.key, "unit.key", 64).toLowerCase(); if (!KEY.test(key)) throw new Error("unit.key is invalid");
  const parentUnitId = row.parentUnitId ? id(row.parentUnitId, "unit.parentUnitId") : undefined;
  return { id: id(row.id, "unit.id"), key, name: required(row.name, "unit.name", 120), kind,
    status: row.status === "inactive" ? "inactive" : "active", ...(parentUnitId ? { parentUnitId } : {}),
    ...(text(row.description, 1000) ? { description: text(row.description, 1000) } : {}), sortOrder: order(row.sortOrder),
    ...(row.projectFlow !== undefined ? { projectFlow: parseOrganizationFlow(row.projectFlow) } : {}),
    createdAt: text(row.createdAt, 64) || now, updatedAt: text(row.updatedAt, 64) || now };
}

export function parseOrganizationSeat(v: unknown, now = new Date().toISOString()): OrganizationSeat {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("organization seat must be an object");
  const row = v as Partial<OrganizationSeat>, seatMode = String(row.seatMode || "permanent") as OrganizationSeatMode,
    state = String(row.state || "active") as OrganizationSeatState;
  if (!SEAT_MODES.has(seatMode) || !SEAT_STATES.has(state)) throw new Error("organization seat state/mode is invalid");
  const reportsToSeatId = row.reportsToSeatId ? id(row.reportsToSeatId, "seat.reportsToSeatId") : undefined;
  const responsibilities = Array.isArray(row.responsibilities) ? row.responsibilities.map((x) => text(x, 240)).filter(Boolean).slice(0, 32) : [];
  return { id: id(row.id, "seat.id"), unitId: id(row.unitId, "seat.unitId"), name: required(row.name, "seat.name", 120),
    title: required(row.title, "seat.title", 160), role: required(row.role, "seat.role", 80), state, seatMode,
    ...(reportsToSeatId ? { reportsToSeatId } : {}), ...(text(row.description, 1000) ? { description: text(row.description, 1000) } : {}),
    responsibilities, target: target(row.target), sortOrder: order(row.sortOrder), createdAt: text(row.createdAt, 64) || now, updatedAt: text(row.updatedAt, 64) || now };
}

function assertNoCycles(ids: string[], parent: (id: string) => string | undefined, label: string) {
  const known = new Set(ids);
  for (const start of ids) { const seen = new Set<string>(); let current: string | undefined = start;
    while (current) { if (seen.has(current)) throw new Error(`${label} cycle detected`); seen.add(current); const next = parent(current); if (next && !known.has(next)) throw new Error(`${label} parent not found`); current = next; } }
}

export function validateOrganizationChart(chart: Omit<OrganizationChart, "revision">): void {
  if (chart.units.length > 256 || chart.seats.length > 1024) throw new Error("organization chart limit reached");
  const unitIds = chart.units.map((u) => u.id), seatIds = chart.seats.map((s) => s.id);
  if (new Set(unitIds).size !== unitIds.length || new Set(seatIds).size !== seatIds.length) throw new Error("organization ids must be unique");
  const keys = chart.units.map((u) => u.key); if (new Set(keys).size !== keys.length) throw new Error("organization unit keys must be unique");
  const unitById = new Map(chart.units.map((u) => [u.id, u])); const seatById = new Map(chart.seats.map((s) => [s.id, s]));
  for (const seat of chart.seats) { if (!unitById.has(seat.unitId)) throw new Error(`seat unit not found: ${seat.name}`); if (seat.reportsToSeatId === seat.id) throw new Error("seat cannot report to itself"); }
  assertNoCycles(unitIds, (x) => unitById.get(x)?.parentUnitId, "organization unit");
  assertNoCycles(seatIds, (x) => seatById.get(x)?.reportsToSeatId, "organization reporting");
}
