import { describe, expect, it } from "vitest";
import type { GraphCustomNode } from "@/lib/contracts/graph-custom-nodes";
import type { OrganizationFlowEdge, OrganizationFlowNode } from "@/lib/contracts/organization-flow";
import { organizationProjectFlowVisibleIds } from "./project-flow-focus";

const nodes: OrganizationFlowNode[] = [
  { id: "a", title: "Research", kind: "activity", status: "active", summary: "Discover", notes: "", position: { x: 0, y: 0 } },
  { id: "b", title: "Draft", kind: "activity", status: "planned", summary: "Write", notes: "", position: { x: 200, y: 0 } },
  { id: "c", title: "Review", kind: "activity", status: "planned", summary: "Check", notes: "", position: { x: 400, y: 0 } },
  { id: "d", title: "Publish", kind: "activity", status: "planned", summary: "Ship", notes: "", position: { x: 600, y: 0 } },
];
const edges: OrganizationFlowEdge[] = [
  { id: "ab", source: "a", target: "b", label: "" },
  { id: "bc", source: "b", target: "c", label: "" },
  { id: "cd", source: "c", target: "d", label: "" },
];
const groups: GraphCustomNode[] = [{ id: "editorial", name: "Editorial", nodeIds: ["b", "c"], collapsed: true }];

describe("organization project-flow focus", () => {
  it("shows the whole map without search or focus", () => {
    expect([...organizationProjectFlowVisibleIds({ nodes, edges, groups, query: "" })]).toEqual(["a", "b", "c", "d"]);
  });
  it("focuses a group plus its one-hop boundary context", () => {
    expect([...organizationProjectFlowVisibleIds({ nodes, edges, groups, query: "", focusGroupId: "editorial" })].sort()).toEqual(["a", "b", "c", "d"]);
  });
  it("focuses one node plus immediate neighbors", () => {
    expect([...organizationProjectFlowVisibleIds({ nodes, edges, groups, query: "", focusNodeId: "b" })].sort()).toEqual(["a", "b", "c"]);
  });
  it("lets search find a custom group by its group name", () => {
    expect([...organizationProjectFlowVisibleIds({ nodes, edges, groups, query: "editorial" })].sort()).toEqual(["a", "b", "c", "d"]);
  });
});
