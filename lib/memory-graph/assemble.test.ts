import { describe, expect, it } from "vitest";
import { assembleMemoryGraph, neighbourhood } from "./assemble";
import type { GraphInputNode } from "./types";

const notes: GraphInputNode[] = [
  { id: "note:a/alpha", title: "Alpha", kind: "note", group: "a", text: "See [[Beta]] and [more](beta.md) #topic" },
  { id: "note:a/beta", title: "Beta", kind: "note", group: "a", text: "[[Missing Page]]" },
];

describe("assembleMemoryGraph", () => {
  it("resolves wikilinks and markdown hrefs, and keeps unresolved titles as ghosts", () => {
    const graph = assembleMemoryGraph(notes, []);
    const edge = (kind: string, target: string) => graph.edges.find((item) => item.kind === kind && item.target === target);
    expect(edge("wikilink", "note:a/beta")?.resolved).toBe(true);
    expect(edge("mention", "note:a/beta")?.resolved).toBe(true);
    expect(graph.nodes.find((node) => node.id === "ghost:missing-page")).toMatchObject({ kind: "ghost", group: "Unresolved" });
    expect(graph.nodes.find((node) => node.kind === "tag")?.title).toBe("#topic");
    expect(graph.nodes.some((node) => "text" in node)).toBe(false);
    expect(graph.counts.ghosts).toBe(1);
  });

  it("limits a local neighbourhood to the requested hop depth", () => {
    const graph = assembleMemoryGraph(notes, [
      { source: "note:a/alpha", targetId: "note:a/beta", kind: "contains" },
    ]);
    const near = neighbourhood(graph.edges, "note:a/alpha", 1);
    expect(near.has("note:a/beta")).toBe(true);
    expect(near.has("ghost:missing-page")).toBe(false);
    expect(neighbourhood(graph.edges, "note:a/alpha", 2).has("ghost:missing-page")).toBe(true);
  });
});
