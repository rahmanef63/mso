import { describe, expect, it } from "vitest";
import type { MemoryGraphDocument } from "@/lib/memory-graph/types";
import { placeNodes } from "./layout";
import { viewGraph } from "./view-model";

const graph: MemoryGraphDocument = {
  truncated: false,
  warnings: [],
  root: "/vault",
  counts: { notes: 2, memories: 0, ghosts: 1 },
  nodes: [
    { id: "note:a", title: "Alpha", kind: "note", group: "daily", degree: 2 },
    { id: "note:b", title: "Beta", kind: "note", group: "daily", degree: 1 },
    { id: "ghost:missing", title: "Missing", kind: "ghost", group: "Unresolved", degree: 1 },
    { id: "tag:topic", title: "#topic", kind: "tag", group: "Tags", degree: 1 },
  ],
  edges: [
    { source: "note:a", target: "note:b", kind: "wikilink", resolved: true },
    { source: "note:a", target: "ghost:missing", kind: "wikilink", resolved: false },
    { source: "note:b", target: "tag:topic", kind: "tag", resolved: true },
  ],
};

const base = { query: "", showGhosts: true, showTags: false, showOrphans: true, local: false, depth: 1, focusId: null, hiddenGroups: [] };

describe("memory graph view", () => {
  it("places a radial hub at the origin and layers hops to the right", () => {
    const radial = placeNodes(graph.nodes, graph.edges, "radial");
    expect(radial.get("note:a")).toEqual({ x: 0, y: 0 });
    const layered = placeNodes(graph.nodes, graph.edges, "layered");
    expect(layered.get("note:a")?.x).toBe(0);
    expect(layered.get("note:b")!.x).toBeGreaterThan(layered.get("note:a")!.x);
    const web = placeNodes(graph.nodes, graph.edges, "web");
    expect(placeNodes(graph.nodes, graph.edges, "web")).toEqual(web);
  });

  it("hides ghosts and tags, and keeps a one-hop local neighbourhood", () => {
    const hidden = viewGraph(graph, { ...base, showGhosts: false });
    expect(hidden.nodes.map((node) => node.kind).sort()).toEqual(["note", "note"]);
    const local = viewGraph(graph, { ...base, showGhosts: true, local: true, focusId: "note:b", depth: 1 });
    expect(local.nodes.map((node) => node.id).sort()).toEqual(["note:a", "note:b"]);
  });
});
