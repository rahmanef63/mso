import { describe, expect, it } from "vitest";
import { computeConnectorRoute, createRoutingScene, GraphRouteCache, type ConnectorRequest } from "../components/shared/graph-route-cache";

const request: ConnectorRequest = {
  id: "edge", source: "source", target: "target",
  a: { x: 100, y: 40 }, b: { x: 121, y: 40 },
  sourceSide: "right", targetSide: "left",
};

describe("shared graph route cache", () => {
  it("keeps a clear short facing connection direct instead of marking a false overlap", () => {
    const scene = createRoutingScene([
      { id: "source", x: 0, y: 0, width: 100, height: 80 },
      { id: "target", x: 121, y: 0, width: 100, height: 80 },
    ], [{ id: "edge", source: "source", target: "target" }]);
    expect(computeConnectorRoute(scene, request)).toMatchObject({
      points: [request.a, request.b], blocked: false,
    });
  });

  it("reuses an unaffected route when an unrelated obstacle moves", () => {
    const edges = [{ id: "edge", source: "source", target: "target" }];
    const sceneA = createRoutingScene([
      { id: "source", x: 0, y: 0, width: 100, height: 80 },
      { id: "target", x: 121, y: 0, width: 100, height: 80 },
      { id: "other", x: 500, y: 300, width: 120, height: 80 },
    ], edges);
    const sceneB = createRoutingScene([
      { id: "source", x: 0, y: 0, width: 100, height: 80 },
      { id: "target", x: 121, y: 0, width: 100, height: 80 },
      { id: "other", x: 650, y: 420, width: 120, height: 80 },
    ], edges);
    const cache = new GraphRouteCache();
    const first = cache.resolve(sceneA, request);
    const second = cache.resolve(sceneB, request);
    expect(second).toBe(first);
    expect(cache.computations).toBe(1);
    expect(cache.hits).toBe(1);
  });

  it("reuses all 400 cached routes for an unrelated node movement at the supported edge limit", () => {
    const edges = Array.from({ length: 400 }, (_, index) => ({ id: `edge-${index}`, source: "source", target: "target" }));
    const nodesA = [
      { id: "source", x: 0, y: 0, width: 100, height: 80 },
      { id: "target", x: 121, y: 0, width: 100, height: 80 },
      ...Array.from({ length: 198 }, (_, index) => ({ id: `other-${index}`, x: 500 + index * 8, y: 400 + (index % 9) * 100, width: 80, height: 60 })),
    ];
    const nodesB = nodesA.map((node) => node.id === "other-197" ? { ...node, x: node.x + 200, y: node.y + 200 } : node);
    const sceneA = createRoutingScene(nodesA, edges);
    const sceneB = createRoutingScene(nodesB, edges);
    expect(new Set(sceneA.lanes.values()).size).toBe(400);
    expect(Math.min(...sceneA.lanes.values())).toBe(0);
    expect(Math.max(...sceneA.lanes.values())).toBe(399);
    const cache = new GraphRouteCache();
    for (const edge of edges) cache.resolve(sceneA, { ...request, id: edge.id });
    for (const edge of edges) cache.resolve(sceneB, { ...request, id: edge.id });
    expect(cache.computations).toBe(400);
    expect(cache.hits).toBe(400);
  });

  it("recomputes when endpoint geometry changes", () => {
    const edges = [{ id: "edge", source: "source", target: "target" }];
    const sceneA = createRoutingScene([
      { id: "source", x: 0, y: 0, width: 100, height: 80 },
      { id: "target", x: 121, y: 0, width: 100, height: 80 },
    ], edges);
    const sceneB = createRoutingScene([
      { id: "source", x: 0, y: 0, width: 100, height: 80 },
      { id: "target", x: 180, y: 0, width: 100, height: 80 },
    ], edges);
    const cache = new GraphRouteCache();
    cache.resolve(sceneA, request);
    cache.resolve(sceneB, { ...request, b: { x: 180, y: 40 } });
    expect(cache.computations).toBe(2);
  });
});
