import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("graph-level routing ownership", () => {
  it("owns the obstacle scene above individual routed edges", () => {
    const canvas = readFileSync("components/shared/graph-canvas.tsx", "utf8");
    const edge = readFileSync("components/shared/graph-routed-edge.tsx", "utf8");
    expect(canvas).toContain("<GraphRoutingProvider");
    expect(edge).not.toContain("useNodes");
    expect(edge).not.toContain("useEdges");
    expect(edge).toContain("routing.cache.resolve");
  });
});
