// Fixtures for memory-org-agents-refactor.test.ts. Kept out of the test file so
// the suite stays under the repository's file-length ratchet.

import type { MemoryGraphEdge, MemoryGraphNode } from "../src/lib/memory-graph/memory-graph-api.ts";
import type { OrganizationChart, OrganizationSeat, OrganizationUnit } from "../src/lib/organization/org-api.ts";
import type { AgentVaultNote } from "../src/lib/agent-vault/agent-vault-api.ts";

export const signal = new AbortController().signal;

function node(id: string, degree: number, extra: Partial<MemoryGraphNode> = {}): MemoryGraphNode {
  return { id, title: id, kind: "note", group: "docs", degree, ...extra };
}

export const graphNodes: MemoryGraphNode[] = [
  node("a", 2), node("b", 1), node("c", 1), node("z", 0, { kind: "ghost", group: "unlinked" }),
];
export const graphEdges: MemoryGraphEdge[] = [
  { source: "a", target: "b", kind: "wikilink", resolved: true },
  { source: "a", target: "c", kind: "mention", resolved: false },
];

const TS0 = "2026-11-01T00:00:00.000Z";

export function unit(id: string, parent?: string): OrganizationUnit {
  return {
    id, key: id, name: `Unit ${id}`, kind: "team", status: "active", sortOrder: 1,
    createdAt: TS0, updatedAt: TS0, ...(parent ? { parentUnitId: parent } : {}),
  };
}

function seat(id: string, unitId: string, reportsTo?: string): OrganizationSeat {
  return {
    id, unitId, name: `Seat ${id}`, title: `Title ${id}`, role: "engineer", state: "active",
    seatMode: "permanent", responsibilities: ["Ship"], target: { kind: "none" }, sortOrder: 1,
    createdAt: TS0, updatedAt: TS0, ...(reportsTo ? { reportsToSeatId: reportsTo } : {}),
  };
}

export const chart: OrganizationChart = {
  version: 1, name: "MSO Fleet", revision: "rev-1", updatedAt: TS0,
  units: [unit("root"), unit("child", "root"), unit("grand", "child")],
  seats: [seat("s1", "root"), seat("s2", "root", "s1"), seat("s3", "child", "s1")],
};

export const jsonOf = (body: unknown, status = 200): typeof fetch => async () =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response);

export const notes: AgentVaultNote[] = [
  { path: "Snapshots/snap-1/overview/Beranda.md", title: "Beranda", kind: "overview", source: "generated" },
  { path: "Snapshots/snap-1/progress/Plan.md", title: "Plan", kind: "progress", source: "docs/plan.md" },
  { path: "Snapshots/snap-1/progress/Done.md", title: "Done", kind: "progress", source: "docs/done.md" }];
