import { describe, expect, it } from "vitest";
import { graphEntryNodeIds, graphFocusClusterIds } from "../components/shared/graph-focus";

describe("shared graph focus", () => {
  it("uses graph roots as the deterministic fallback focus", () => {
    const nodes = ["root", "a", "b"];
    const edges = [{ source: "root", target: "a" }, { source: "a", target: "b" }];
    expect(graphEntryNodeIds(nodes, edges, 2)).toEqual(["root"]);
    expect(graphFocusClusterIds(nodes, edges)).toEqual(["root", "a"]);
  });

  it("includes direct relationships in both directions and respects depth", () => {
    const nodes = ["a", "b", "c", "d"];
    const edges = [{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "d", target: "b" }];
    expect(graphFocusClusterIds(nodes, edges, ["b"], { depth: 1, maxNodes: 10 })).toEqual(["b", "a", "c", "d"]);
    expect(graphFocusClusterIds(nodes, edges, ["a"], { depth: 2, maxNodes: 10 })).toEqual(["a", "b", "c", "d"]);
  });

  it("stays bounded for large graphs", () => {
    const nodes = Array.from({ length: 120 }, (_, index) => "n-" + index);
    const edges = nodes.slice(1).map((id, index) => ({ source: "n-" + index, target: id }));
    const focused = graphFocusClusterIds(nodes, edges, ["n-60"], { depth: 50, maxNodes: 12 });
    expect(focused).toHaveLength(12);
    expect(new Set(focused).size).toBe(12);
  });

  it("falls back safely for cycles without roots", () => {
    const nodes = ["a", "b", "c"];
    const edges = [{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "c", target: "a" }];
    expect(graphEntryNodeIds(nodes, edges)).toEqual(["a"]);
    expect(graphFocusClusterIds(nodes, edges, [], { depth: 1, maxNodes: 3 })).toEqual(["a", "b", "c"]);
  });
});
