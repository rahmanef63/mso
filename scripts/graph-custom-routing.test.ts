import { describe, expect, it } from "vitest";
import { parseGraphCustomNodes, pruneGraphCustomNodes } from "../lib/contracts/graph-custom-nodes";
import { projectCustomNodes, moveCustomNode } from "../components/shared/graph-custom-projection";
import { orthogonalRoute, segmentBlocked, routePath } from "../components/shared/graph-route";
import { parseWorkflowGraphDefinition } from "../lib/workflow/graph-schema";
import { changeOrganizationFlow } from "../lib/agent/organization-flow-mutations";

const members = new Set(["a", "b", "c"]);
const group = { id: "custom-one", name: "My custom node", nodeIds: ["a", "b"], collapsed: true };
const nodes = ["a", "b", "c"].map((id, i) => ({ id, position: { x: i * 300, y: i * 60 }, data: {} }));
const edges = [{ id: "internal", source: "a", target: "b", sourceHandle: "true" }, { id: "boundary", source: "b", target: "c", sourceHandle: "error" }];
describe("custom node contract", () => {
  it("accepts one or several members, rejects invalid or overlapping membership", () => {
    expect(parseGraphCustomNodes([group], members)).toEqual([group]);
    expect(parseGraphCustomNodes([{ ...group, nodeIds: ["a"] }], members)[0].nodeIds).toHaveLength(1);
    for (const value of [[{ ...group, nodeIds: [] }], [{ ...group, nodeIds: ["missing"] }], [{ ...group, nodeIds: ["a", "a"] }], [group, { ...group, id: "another" }], [{ ...group, id: "a" }], [{ ...group, name: " " }]]) expect(() => parseGraphCustomNodes(value, members)).toThrow();
  });
  it("renders proxies without rewriting original nodes, ports, configs or edges", () => {
    const before = JSON.stringify({ nodes, edges });
    const projected = projectCustomNodes(nodes, edges, [group], [group.id]);
    expect(projected.nodes.map((n) => n.id)).toEqual(["c", group.id]);
    expect(projected.edges).toHaveLength(1);
    expect(projected.edges[0]).toMatchObject({ id: "boundary", source: group.id, target: "c", sourceHandle: "out-boundary" });
    expect(projected.nodes.at(-1)).toMatchObject({ data: { ports: [{ id: "out-boundary", label: "error", side: "out" }] } });
    expect(JSON.stringify({ nodes, edges })).toBe(before);
    expect(projectCustomNodes(nodes, edges, [{ ...group, collapsed: false }], []).edges).toEqual(edges);
  });
  it("handles two collapsed groups and keeps each boundary port separate", () => {
    const second = { ...group, id: "custom-two", nodeIds: ["c"] };
    const result = projectCustomNodes(nodes, edges, [group, second], []);
    expect(result.edges[0]).toMatchObject({ source: group.id, target: second.id, sourceHandle: "out-boundary", targetHandle: "in-boundary" });
    expect(projectCustomNodes([], [], [group], []).nodes).toEqual([]);
  });
  it("moves members together and only removes grouping on ungroup", () => {
    const moved = moveCustomNode(nodes, group, { x: 100, y: 200 });
    expect(moved[0].position).toEqual({ x: 100, y: 200 }); expect(moved[1].position).toEqual({ x: 400, y: 260 }); expect(moved[2]).toBe(nodes[2]);
    expect(pruneGraphCustomNodes([group], new Set(["b", "c"]))[0].nodeIds).toEqual(["b"]);
    expect(pruneGraphCustomNodes([group], new Set(["c"]))).toEqual([]);
  });
  it("roundtrips workflow grouping without changing executable topology", () => {
    const base = { name: "Test", description: "", status: "draft", inputs: {}, nodes: nodes.map((n) => ({ ...n, name: n.id, type: "output", config: {} })), edges };
    const parsed = parseWorkflowGraphDefinition({ ...base, metadata: { customNodes: [group] } });
    expect(parsed.metadata.customNodes).toEqual([group]); expect(parsed.edges).toEqual(edges);
    expect(() => parseWorkflowGraphDefinition({ ...base, metadata: { customNodes: [{ ...group, nodeIds: ["foreign"] }] } })).toThrow();
  });
  it("supports native organization grouping, atomic moves and safe member deletion", () => {
    let flow = changeOrganizationFlow(undefined, "flow_node_upsert", { node: { id: "a", title: "A" } });
    flow = changeOrganizationFlow(flow, "flow_node_upsert", { node: { id: "b", title: "B" } });
    flow = changeOrganizationFlow(flow, "flow_custom_nodes", { customNodes: [group] });
    const before = JSON.stringify(flow);
    expect(() => changeOrganizationFlow(flow, "flow_nodes_move", { positions: [{ id: "a", position: { x: 1, y: 2 } }, { id: "foreign", position: { x: 0, y: 0 } }] })).toThrow();
    expect(JSON.stringify(flow)).toBe(before);
    flow = changeOrganizationFlow(flow, "flow_nodes_move", { positions: [{ id: "a", position: { x: 250, y: 120 } }] });
    expect(flow.nodes[0].position).toEqual({ x: 250, y: 120 });
    flow = changeOrganizationFlow(flow, "flow_node_delete", { id: "a" });
    expect(flow.customNodes?.[0].nodeIds).toEqual(["b"]);
  });
});
describe("obstacle-aware connectors", () => {
  it("routes forward and reverse paths around intervening node cards", () => {
    const obstacles = [{ x: 100, y: -50, width: 160, height: 180 }, { x: 310, y: -130, width: 100, height: 180 }];
    for (const [a, b] of [[{ x: 0, y: 0 }, { x: 500, y: 0 }], [{ x: 500, y: 0 }, { x: 0, y: 0 }], [{ x: 0, y: 200 }, { x: 500, y: -180 }]]) {
      const points = orthogonalRoute(a, b, obstacles)!; expect(points).not.toBeNull(); expect(points[0]).toEqual(a); expect(points.at(-1)).toEqual(b);
      for (let i = 1; i < points.length; i++) expect(segmentBlocked(points[i - 1], points[i], obstacles)).toBe(false);
      expect(routePath(points)).not.toMatch(/NaN|Infinity/);
    }
  });
  it("uses bounded routing and reports impossible overlaps instead of claiming clearance", () => {
    expect(orthogonalRoute({ x: 5, y: 5 }, { x: 200, y: 200 }, [{ x: 0, y: 0, width: 20, height: 20 }])).toBeNull();
    expect(orthogonalRoute({ x: NaN, y: 0 }, { x: 0, y: 0 }, [])).toBeNull();
    expect(orthogonalRoute({ x: 0, y: 0 }, { x: 100, y: 0 }, [])).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  });
});
