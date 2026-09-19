import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, open, rm } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { changeOrganizationFlow } from "./organization-flow-mutations";
import { parseOrganizationFlow, parseFlowNode } from "./organization-flow-schema";
import { emptyOrganizationFlow, ORGANIZATION_FLOW_ACTIONS } from "@/lib/contracts/organization-flow";

const node = (id: string) => ({ id, title: id, kind: "project", status: "unconfirmed", summary: "", notes: "", position: { x: 0, y: 0 } });
let dir = "";
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "mso-org-flow-")); process.env.OS_ORGANIZATION_STORE = path.join(dir, "organization.json"); vi.resetModules(); });
afterEach(async () => { delete process.env.OS_ORGANIZATION_STORE; await rm(dir, { recursive: true, force: true }); vi.resetModules(); });

async function fixture() {
  const api = await import("./organization-store");
  let chart = await api.getOrganizationChart();
  chart = await api.upsertOrganizationUnit(chart.revision, { id: "unit-a", key: "a", name: "A" });
  chart = await api.upsertOrganizationUnit(chart.revision, { id: "unit-b", key: "b", name: "B" });
  return { api, chart };
}

describe("organization project flow persistence", () => {
  it("stores multiline notes inside a unit and keeps them when a legacy unit editor saves", async () => {
    const { api, chart } = await fixture();
    const next = await api.mutateOrganizationFlow(chart.revision, "flow_update", { unitId: "unit-a", title: "Delivery", notes: "# Source\n\nStill unconfirmed.\n" });
    const saved = await api.upsertOrganizationUnit(next.revision, { id: "unit-a", key: "a", name: "A", description: "Brief summary" });
    expect(saved.units.find((u) => u.id === "unit-a")?.projectFlow?.notes).toBe("# Source\n\nStill unconfirmed.\n");
    expect(saved.units.find((u) => u.id === "unit-b")?.projectFlow).toBeUndefined();
    expect(saved.seats).toEqual(chart.seats);
    const handle = await open(api.ORGANIZATION_STORE_PATH, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      expect((await handle.stat()).mode & 0o077).toBe(0);
      const raw = JSON.parse(await handle.readFile("utf8"));
      expect(raw.units.find((u: { id: string }) => u.id === "unit-a").projectFlow.title).toBe("Delivery");
    } finally { await handle.close(); }
    expect((await api.getOrganizationChart()).units).toEqual(saved.units);
  });
  it("supports node/edge CRUD and position-only patches without dropping notes", async () => {
    const { api, chart } = await fixture();
    let next = await api.mutateOrganizationFlow(chart.revision, "flow_node_upsert", { unitId: "unit-a", node: { ...node("n1"), notes: "Evidence, not a contract" } });
    next = await api.mutateOrganizationFlow(next.revision, "flow_node_upsert", { unitId: "unit-a", node: node("n2") });
    next = await api.mutateOrganizationFlow(next.revision, "flow_edge_upsert", { unitId: "unit-a", edge: { id: "e1", source: "n1", target: "n2", label: "supports" } });
    next = await api.mutateOrganizationFlow(next.revision, "flow_node_upsert", { unitId: "unit-a", node: { id: "n1", position: { x: 240, y: -50 } } });
    expect(next.units[0].projectFlow?.nodes[0]).toMatchObject({ notes: "Evidence, not a contract", position: { x: 240, y: -50 } });
    next = await api.mutateOrganizationFlow(next.revision, "flow_edge_upsert", { unitId: "unit-a", edge: { id: "e1", label: "provisional" } });
    expect(next.units[0].projectFlow?.edges[0].label).toBe("provisional");
    next = await api.mutateOrganizationFlow(next.revision, "flow_edge_delete", { unitId: "unit-a", id: "e1" });
    expect(next.units[0].projectFlow?.edges).toEqual([]);
    next = await api.mutateOrganizationFlow(next.revision, "flow_edge_upsert", { unitId: "unit-a", edge: { source: "n1", target: "n2" } });
    next = await api.mutateOrganizationFlow(next.revision, "flow_node_delete", { unitId: "unit-a", id: "n1" });
    expect(next.units[0].projectFlow?.nodes.map((n) => n.id)).toEqual(["n2"]);
    expect(next.units[0].projectFlow?.edges).toEqual([]);
  });
  it("rejects stale revisions, unknown units/actions, and cross-unit edges without writes", async () => {
    const { api, chart } = await fixture();
    const next = await api.mutateOrganizationFlow(chart.revision, "flow_node_upsert", { unitId: "unit-a", node: node("only-a") });
    await expect(api.mutateOrganizationFlow(chart.revision, "flow_update", { unitId: "unit-a", notes: "stale" })).rejects.toThrow(/revision changed/);
    await expect(api.mutateOrganizationFlow(next.revision, "flow_update", {})).rejects.toThrow(/unitId/);
    await expect(api.mutateOrganizationFlow(next.revision, "flow_update", { unitId: "missing" })).rejects.toThrow(/not found/);
    await expect(api.mutateOrganizationFlow(next.revision, "execute", { unitId: "unit-a" })).rejects.toThrow(/unsupported/);
    await expect(api.mutateOrganizationFlow(next.revision, "flow_edge_upsert", { unitId: "unit-b", edge: { source: "only-a", target: "missing" } })).rejects.toThrow(/endpoint/);
    expect((await api.getOrganizationChart()).revision).toBe(next.revision);
  });
  it("exposes callable flow actions through the existing read/write MCP tools", async () => {
    const { chart } = await fixture();
    const { ORGANIZATION_TOOLS } = await import("@/lib/mcp/tools-organization");
    const read = ORGANIZATION_TOOLS.find((t) => t.name === "organization_chart")!;
    const write = ORGANIZATION_TOOLS.find((t) => t.name === "organization_manage")!;
    expect(read.scope).toBe("read"); expect(write.scope).toBe("write"); expect(write.audit?.action).toBe("agent.organization");
    expect(JSON.stringify(write.inputSchema)).toContain("flow_node_upsert");
    const output = await write.run({ action: "flow_node_upsert", expected_revision: chart.revision, data: { unitId: "unit-a", node: node("via-mcp") } }, { principal: "test", scope: "write" } as never) as { chart: typeof chart };
    expect(output.chart.units[0].projectFlow?.nodes[0].id).toBe("via-mcp");
    const reread = await read.run({ runtime: false }, { principal: "test" } as never) as { chart: typeof chart };
    expect(reread.chart.revision).toBe(output.chart.revision);
    expect(ORGANIZATION_FLOW_ACTIONS).toEqual(expect.arrayContaining(["flow_custom_nodes", "flow_nodes_move", "flow_update", "flow_node_upsert", "flow_node_delete", "flow_edge_upsert", "flow_edge_delete", "flow_replace"]));
  });
});

describe("bounded contextual graph schema", () => {
  it("has no executor and defaults new nodes to unconfirmed", () => {
    const flow = changeOrganizationFlow(undefined, "flow_node_upsert", { node: { title: "Draft", run: "never", command: "never" } });
    expect(flow.nodes[0]).toMatchObject({ status: "unconfirmed", kind: "project" });
    expect(flow.nodes[0]).not.toHaveProperty("run"); expect(flow.nodes[0]).not.toHaveProperty("command");
  });
  it("accepts references and exact note text, rejects malformed shapes and overlong data", () => {
    expect(parseFlowNode({ ...node("n"), projectRef: "project-a" }).projectRef).toBe("project-a");
    for (const value of [null, [], "x", 1]) expect(() => parseOrganizationFlow(value)).toThrow();
    expect(() => parseOrganizationFlow({ ...emptyOrganizationFlow(), version: 2 })).toThrow(/version/);
    expect(() => parseOrganizationFlow({ ...emptyOrganizationFlow(), notes: "x".repeat(64001) })).toThrow(/64000/);
    expect(() => parseFlowNode({ ...node("n"), notes: "x".repeat(12001) })).toThrow(/12000/);
    expect(() => parseFlowNode({ ...node("n"), title: " " })).toThrow(/required/);
    expect(() => parseFlowNode({ ...node("n"), id: "../bad" })).toThrow(/invalid/);
    expect(() => parseFlowNode({ ...node("n"), kind: "shell" })).toThrow(/kind/);
    expect(() => parseFlowNode({ ...node("n"), status: "approved-by-ai" })).toThrow(/status/);
    for (const x of [NaN, Infinity, "12", 100001]) expect(() => parseFlowNode({ ...node("n"), position: { x, y: 0 } })).toThrow(/position/);
  });
  it("rejects duplicate, cross-unit, self and over-limit graph objects", () => {
    const flow = { ...emptyOrganizationFlow(), nodes: [node("n")] };
    expect(() => parseOrganizationFlow({ ...flow, nodes: [node("n"), node("n")] })).toThrow(/unique/);
    expect(() => parseOrganizationFlow({ ...flow, edges: [{ id: "e", source: "n", target: "n" }] })).toThrow(/itself/);
    expect(() => parseOrganizationFlow({ ...flow, edges: [{ id: "e", source: "n", target: "other-unit-node" }] })).toThrow(/endpoint/);
    expect(() => parseOrganizationFlow({ ...flow, nodes: Array.from({ length: 201 }, (_, i) => node(`n${i}`)) })).toThrow(/bounded/);
    expect(() => parseOrganizationFlow({ ...flow, edges: Array(401).fill({}) })).toThrow(/bounded/);
  });
  it("preserves the input snapshot and replaces only when explicitly requested", () => {
    const current = { ...emptyOrganizationFlow(), nodes: [parseFlowNode(node("n"))] };
    const updated = changeOrganizationFlow(current, "flow_update", { notes: "updated", nodes: [] });
    expect(updated.nodes).toEqual(current.nodes); expect(current.notes).toBe("");
    expect(changeOrganizationFlow(current, "flow_replace", { flow: emptyOrganizationFlow() }).nodes).toEqual([]);
    expect(() => changeOrganizationFlow(current, "flow_node_delete", { id: "missing" })).toThrow(/not found/);
    expect(() => changeOrganizationFlow(current, "flow_edge_delete", { id: "missing" })).toThrow(/not found/);
  });
});
