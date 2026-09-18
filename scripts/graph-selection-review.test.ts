import { describe, expect, it } from "vitest";
import { reconcileGraphProjection } from "../components/shared/use-graph-projection";
import type { Edge, Node } from "@xyflow/react";
const make = (selected: string[]) => ({ nodes: ["a", "b", "c"].map((id): Node => ({ id, position: { x: 0, y: 0 }, data: {}, selected: selected.includes(id) })), edges: [] as Edge[] });
describe("review: controlled graph selection", () => {
  it("selects an existing node when the parent changes selection without a node event", () => {
    const source = make([]);
    const next = reconcileGraphProjection(make(["b"]), { ...source, source });
    expect(next.nodes.filter((n) => n.selected).map((n) => n.id)).toEqual(["b"]);
  });
  it("clears stale transient selection when the parent explicitly clears", () => {
    const source = make(["a"]);
    const previous = { source, ...make(["a", "b"]) };
    expect(reconcileGraphProjection(make([]), previous).nodes.some((n) => n.selected)).toBe(false);
  });
  it("preserves ctrl/box multi-selection across data-only updates", () => {
    const source = make(["a"]);
    const previous = { source, ...make(["a", "b"]) };
    expect(reconcileGraphProjection(make(["a"]), previous).nodes.filter((n) => n.selected).map((n) => n.id)).toEqual(["a", "b"]);
  });
});
