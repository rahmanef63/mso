import { describe, expect, it } from "vitest";
import type { OrganizationChart, OrganizationSeat, OrganizationUnit } from "@/lib/contracts/organization";
import { organizationSeatLayout, organizationUnitLayout } from "./canvas-layout";

const stamp = "2026-01-01T00:00:00Z";
const unit = (id: string, parentUnitId?: string): OrganizationUnit => ({ id, key: id, name: id, kind: parentUnitId ? "company" : "holding", status: "active", parentUnitId, sortOrder: 0, createdAt: stamp, updatedAt: stamp });
const seat = (id: string, unitId: string, reportsToSeatId?: string): OrganizationSeat => ({ id, unitId, name: id, title: id, role: "ceo", state: "active", seatMode: "permanent", reportsToSeatId, responsibilities: [], target: { kind: "none" }, sortOrder: 0, createdAt: stamp, updatedAt: stamp });
const chart = (units: OrganizationUnit[], seats: OrganizationSeat[]): OrganizationChart => ({ version: 1, name: "Org", revision: "r", updatedAt: stamp, units, seats });

describe("organization canvas layout", () => {
  it("places child organization units below their parent", () => {
    const rows = organizationUnitLayout(chart([unit("holding"), unit("business", "holding")], []));
    const byId = new Map(rows.map((row) => [row.item.id, row.position]));
    expect(byId.get("business")!.y).toBeGreaterThan(byId.get("holding")!.y);
  });

  it("includes an external reporting parent when a subsidiary seat reports outside its unit", () => {
    const rows = organizationSeatLayout(chart([unit("holding"), unit("subsidiary", "holding")], [seat("holding-ceo", "holding"), seat("subsidiary-ceo", "subsidiary", "holding-ceo")]), "subsidiary");
    expect(rows.map((row) => [row.item.id, row.external])).toEqual(expect.arrayContaining([["holding-ceo", true], ["subsidiary-ceo", false]]));
    const byId = new Map(rows.map((row) => [row.item.id, row.position]));
    expect(byId.get("subsidiary-ceo")!.y).toBeGreaterThan(byId.get("holding-ceo")!.y);
  });
  it("wraps wide sibling rows for compact panes instead of shrinking the whole graph", () => {
    const units = [unit("holding"), ...Array.from({ length: 5 }, (_, index) => unit(`child-${index + 1}`, "holding"))];
    const rows = organizationUnitLayout(chart(units, []), { maxColumns: 2, xGap: 248, yGap: 154, startX: 42, startY: 42 });
    const children = rows.filter((row) => row.item.id.startsWith("child-"));
    const byY = new Map<number, number>();
    for (const row of children) byY.set(row.position.y, (byY.get(row.position.y) ?? 0) + 1);
    expect(byY.size).toBe(3);
    expect(Math.max(...byY.values())).toBeLessThanOrEqual(2);
    expect(Math.max(...children.map((row) => row.position.x)) - Math.min(...children.map((row) => row.position.x))).toBeLessThanOrEqual(248);
  });

});
