import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let dir = "";
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "mso-org-")); process.env.OS_ORGANIZATION_STORE = path.join(dir, "organization.json"); vi.resetModules(); });
afterEach(async () => { delete process.env.OS_ORGANIZATION_STORE; await rm(dir, { recursive: true, force: true }); vi.resetModules(); });

async function store() { return import("./organization-store"); }

describe("organization store", () => {
  it("persists units/seats privately with revision checks and reporting guards", async () => {
    const api = await store();
    let chart = await api.getOrganizationChart();
    expect(chart.units).toEqual([]); expect(chart.seats).toEqual([]);
    chart = await api.upsertOrganizationUnit(chart.revision, { id: "unit_root", key: "root", name: "Root", kind: "holding", status: "active", sortOrder: 0 });
    chart = await api.upsertOrganizationSeat(chart.revision, { id: "seat_ceo", unitId: "unit_root", name: "CEO", title: "Chief Executive Officer", role: "ceo", state: "active", seatMode: "permanent", target: { kind: "none" }, responsibilities: [] });
    chart = await api.upsertOrganizationSeat(chart.revision, { id: "seat_cto", unitId: "unit_root", name: "CTO", title: "Chief Technology Officer", role: "cto", state: "active", seatMode: "on_demand", reportsToSeatId: "seat_ceo", target: { kind: "project-agent", project: "mso" }, responsibilities: ["Technology"] });
    await expect(api.upsertOrganizationSeat(chart.revision, { ...chart.seats.find((s) => s.id === "seat_ceo"), reportsToSeatId: "seat_cto" })).rejects.toThrow(/cycle/i);
    await expect(api.deleteOrganizationSeat(chart.revision, "seat_ceo")).rejects.toThrow(/direct reports/i);
    await expect(api.upsertOrganizationUnit("stale", { id: "unit_other", key: "other", name: "Other", kind: "team" })).rejects.toThrow(/revision changed/i);
    expect((await stat(api.ORGANIZATION_STORE_PATH)).mode & 0o077).toBe(0);
  });

  it("keeps active seats without an executor distinct from vacant seats", async () => {
    const api = await store(); let chart = await api.getOrganizationChart();
    chart = await api.upsertOrganizationUnit(chart.revision, { id: "unit_a", key: "a", name: "A", kind: "company" });
    chart = await api.upsertOrganizationSeat(chart.revision, { id: "seat_active", unitId: "unit_a", name: "Active", title: "CEO", role: "ceo", state: "active", seatMode: "permanent", target: { kind: "none" } });
    chart = await api.upsertOrganizationSeat(chart.revision, { id: "seat_vacant", unitId: "unit_a", name: "Vacant", title: "CFO", role: "cfo", state: "vacant", seatMode: "permanent", target: { kind: "none" } });
    const runtime = await (await import("./organization-runtime")).organizationRuntime();
    expect(runtime.find((x) => x.seatId === "seat_active")?.status).toBe("unbound");
    expect(runtime.find((x) => x.seatId === "seat_vacant")?.status).toBe("vacant");
  });
});
