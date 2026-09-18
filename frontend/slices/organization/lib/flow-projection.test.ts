import { describe, expect, it } from "vitest";
import type { OrganizationFlowNode } from "@/lib/contracts/organization-flow";
import { projectCanvasNodes, updateFlowProjection, type FlowProjection } from "./flow-projection";

const source = (): OrganizationFlowNode[] => [{ id: "one", title: "Project", kind: "project", status: "unconfirmed", summary: "", notes: "", position: { x: 0, y: 0 } }];

describe("organization flow canvas projection", () => {
  it("retains measured dimensions required for edges, not only drag positions", () => {
    const items = source();
    const state = updateFlowProjection(items, { nodes: [] }, [{ type: "dimensions", id: "one", dimensions: { width: 240, height: 95 } }]);
    expect(projectCanvasNodes(items, state)[0].measured).toEqual({ width: 240, height: 95 });
    const dragged = updateFlowProjection(items, state, [{ type: "position", id: "one", position: { x: 90, y: 40 } }]);
    expect(dragged.nodes[0].position).toEqual({ x: 90, y: 40 });
    expect(dragged.nodes[0].measured).toEqual({ width: 240, height: 95 });
  });

  it("uses refreshed backend positions rather than replaying a stale drag", () => {
    const items = source();
    const state = updateFlowProjection(items, { nodes: [] }, [{ type: "position", id: "one", position: { x: 90, y: 40 } }]);
    const refreshed = source(); refreshed[0].title = "Server edit";
    expect(projectCanvasNodes(refreshed, state)[0]).toMatchObject({ position: { x: 0, y: 0 }, data: { item: { title: "Server edit" } } });
  });

  it("does not copy canvas-only measurements to persisted source data", () => {
    const items = source();
    const state: FlowProjection = updateFlowProjection(items, { nodes: [] }, [{ type: "dimensions", id: "one", dimensions: { width: 240, height: 95 } }]);
    expect(items).toEqual(source());
    expect(projectCanvasNodes([], state)).toEqual([]);
    expect(projectCanvasNodes(source(), state)[0].measured).toEqual({ width: 240, height: 95 });
  });
});
