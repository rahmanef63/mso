import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandOwnerStorePath } from "@/lib/owner-store-path.js";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import type { OrganizationChart, OrganizationSeat, OrganizationUnit } from "@/lib/contracts/organization";
import { parseOrganizationSeat, parseOrganizationUnit, validateOrganizationChart } from "./organization-schema";

export const ORGANIZATION_STORE_PATH = expandOwnerStorePath(process.env.OS_ORGANIZATION_STORE ?? path.join(os.homedir(), ".mso", "private", "organization.json"));
const MAX_BYTES = 2 * 1024 * 1024;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
function base(): OrganizationChart { const updatedAt = new Date(0).toISOString(); const row = { version: 1 as const, name: "Organization", updatedAt, units: [], seats: [] }; return { ...row, revision: hash(row) }; }
function materialize(name: string, units: OrganizationUnit[], seats: OrganizationSeat[]): OrganizationChart {
  const row = { version: 1 as const, name: String(name || "Organization").trim().slice(0, 120) || "Organization", updatedAt: new Date().toISOString(), units, seats };
  validateOrganizationChart(row); return { ...row, revision: hash(row) };
}
async function readUnlocked(): Promise<OrganizationChart> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try { handle = await fs.open(ORGANIZATION_STORE_PATH, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW); const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_BYTES || (stat.mode & 0o077) !== 0) throw new Error("organization store is unsafe");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("organization store owner mismatch");
    const raw = JSON.parse(await handle.readFile("utf8")) as Partial<OrganizationChart>; if (raw.version !== 1 || !Array.isArray(raw.units) || !Array.isArray(raw.seats)) throw new Error("organization store shape is invalid");
    const units = raw.units.map((v) => parseOrganizationUnit(v)); const seats = raw.seats.map((v) => parseOrganizationSeat(v)); const chart = materialize(String(raw.name || "Organization"), units, seats);
    return { ...chart, updatedAt: String(raw.updatedAt || chart.updatedAt), revision: typeof raw.revision === "string" ? raw.revision : chart.revision };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return base(); throw error; }
  finally { await handle?.close().catch(() => undefined); }
}
async function writeUnlocked(chart: OrganizationChart) { const body = JSON.stringify(chart, null, 2) + "\n"; if (Buffer.byteLength(body) > MAX_BYTES) throw new Error("organization store exceeds 2 MiB");
  const dir = path.dirname(ORGANIZATION_STORE_PATH); await fs.mkdir(dir, { recursive: true, mode: 0o700 }); await fs.chmod(dir, 0o700).catch(() => undefined);
  const temp = `${ORGANIZATION_STORE_PATH}.${randomUUID()}.tmp`; await fs.writeFile(temp, body, { flag: "wx", mode: 0o600 }); try { await fs.rename(temp, ORGANIZATION_STORE_PATH); await fs.chmod(ORGANIZATION_STORE_PATH, 0o600); } finally { await fs.unlink(temp).catch(() => undefined); } }
export async function getOrganizationChart() { return structuredClone(await readUnlocked()); }
async function mutate(expectedRevision: string, fn: (chart: OrganizationChart) => OrganizationChart) { return withSecurityStoreLock(ORGANIZATION_STORE_PATH, async () => { const current = await readUnlocked(); if (current.revision !== expectedRevision) throw new Error("organization revision changed; refresh before editing"); const next = fn(current); await writeUnlocked(next); return structuredClone(next); }); }
const touch = (row: Record<string, unknown>, previous?: { createdAt?: string }) => ({ ...row, createdAt: previous?.createdAt || row.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
export async function upsertOrganizationUnit(expectedRevision: string, raw: Record<string, unknown>) { return mutate(expectedRevision, (chart) => { const id = typeof raw.id === "string" && raw.id ? raw.id : `unit_${randomUUID()}`; const previous = chart.units.find((u) => u.id === id); const unit = parseOrganizationUnit(touch({ ...raw, id }, previous)); const units = [...chart.units.filter((u) => u.id !== id), unit]; return materialize(chart.name, units, chart.seats); }); }
export async function upsertOrganizationSeat(expectedRevision: string, raw: Record<string, unknown>) { return mutate(expectedRevision, (chart) => { const id = typeof raw.id === "string" && raw.id ? raw.id : `seat_${randomUUID()}`; const previous = chart.seats.find((s) => s.id === id); const seat = parseOrganizationSeat(touch({ ...raw, id }, previous)); const seats = [...chart.seats.filter((s) => s.id !== id), seat]; return materialize(chart.name, chart.units, seats); }); }
export async function deleteOrganizationUnit(expectedRevision: string, id: string) { return mutate(expectedRevision, (chart) => { if (chart.units.some((u) => u.parentUnitId === id) || chart.seats.some((s) => s.unitId === id)) throw new Error("organization unit still has children or seats"); return materialize(chart.name, chart.units.filter((u) => u.id !== id), chart.seats); }); }
export async function deleteOrganizationSeat(expectedRevision: string, id: string) { return mutate(expectedRevision, (chart) => { if (chart.seats.some((s) => s.reportsToSeatId === id)) throw new Error("organization seat still has direct reports"); return materialize(chart.name, chart.units, chart.seats.filter((s) => s.id !== id)); }); }
export async function replaceOrganization(expectedRevision: string, raw: { name?: unknown; units?: unknown; seats?: unknown }) { return mutate(expectedRevision, () => { const units = Array.isArray(raw.units) ? raw.units.map((v) => parseOrganizationUnit(v)) : []; const seats = Array.isArray(raw.seats) ? raw.seats.map((v) => parseOrganizationSeat(v)) : []; return materialize(String(raw.name || "Organization"), units, seats); }); }
