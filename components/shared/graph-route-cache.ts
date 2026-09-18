import { orthogonalRoute, routeLabel, routePath, segmentBlocked, type RoutePoint, type RouteRect } from "./graph-route";

export type RouteSide = "left" | "right" | "top" | "bottom";
export type RoutingNode = RouteRect & { id: string };
export type RoutingEdge = { id: string; source: string; target: string };
export type ConnectorRequest = RoutingEdge & { a: RoutePoint; b: RoutePoint; sourceSide: RouteSide; targetSide: RouteSide };
export type ConnectorGeometry = { points: RoutePoint[]; path: string; label: RoutePoint; blocked: boolean };
export type RoutingScene = {
  rects: Map<string, RouteRect>; obstacles: RouteRect[]; lanes: Map<string, number>;
  changes: WeakMap<RoutingScene, RouteRect[]>;
};
const PAD = 10;
const direction = (side: RouteSide): RoutePoint => side === "left" ? { x: -1, y: 0 } : side === "right" ? { x: 1, y: 0 } : side === "top" ? { x: 0, y: -1 } : { x: 0, y: 1 };
const unpad = (r: RouteRect): RouteRect => ({ x: r.x + PAD, y: r.y + PAD, width: r.width - PAD * 2, height: r.height - PAD * 2 });
const sameRect = (a: RouteRect, b: RouteRect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const intersects = (a: RouteRect, b: RouteRect) => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;

/** One measured obstacle set and sibling index per graph geometry/topology revision. */
export function createRoutingScene(nodes: RoutingNode[], edges: RoutingEdge[]): RoutingScene {
  const rects = new Map(nodes.map((n) => [n.id, { x: n.x - PAD, y: n.y - PAD, width: n.width + PAD * 2, height: n.height + PAD * 2 }]));
  const outgoing = new Map<string, string[]>(), incoming = new Map<string, string[]>();
  for (const e of edges) { outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e.id]); incoming.set(e.target, [...(incoming.get(e.target) ?? []), e.id]); }
  const lanes = new Map(edges.map((e) => [e.id, [...new Set([...(outgoing.get(e.source) ?? []), ...(incoming.get(e.target) ?? [])])].sort().indexOf(e.id)]));
  return { rects, obstacles: [...rects.values()], lanes, changes: new WeakMap() };
}
function changedRects(before: RoutingScene, after: RoutingScene): RouteRect[] {
  const known = after.changes.get(before); if (known) return known;
  const changed: RouteRect[] = [];
  for (const [id, r] of before.rects) { const next = after.rects.get(id); if (!next || !sameRect(r, next)) { changed.push(r); if (next) changed.push(next); } }
  for (const [id, r] of after.rects) if (!before.rects.has(id)) changed.push(r);
  after.changes.set(before, changed); return changed;
}
function escapeDistance(point: RoutePoint, vector: RoutePoint, maximum: number, obstacles: RouteRect[]): number {
  let result = maximum;
  for (const r of obstacles) {
    const across = vector.x ? point.y > r.y && point.y < r.y + r.height : point.x > r.x && point.x < r.x + r.width;
    if (!across) continue;
    const gap = vector.x > 0 ? r.x - point.x : vector.x < 0 ? point.x - r.x - r.width : vector.y > 0 ? r.y - point.y : point.y - r.y - r.height;
    if (gap >= 0) result = Math.min(result, Math.max(0, gap - 0.5));
  }
  return result;
}
function geometry(points: RoutePoint[], blocked = false): ConnectorGeometry { return { points, path: routePath(points), label: routeLabel(points), blocked }; }

export function computeConnectorRoute(scene: RoutingScene, request: ConnectorRequest): ConnectorGeometry {
  const { a, b, source, target, sourceSide, targetSide } = request;
  const sd = direction(sourceSide), td = direction(targetSide), lane = scene.lanes.get(request.id) ?? 0;
  const dx = b.x - a.x, dy = b.y - a.y;
  // A clear facing-port segment is valid even when the two endpoint padding zones meet.
  const facing = sd.x === -td.x && sd.y === -td.y && dx * sd.x + dy * sd.y > 0 && Math.abs(dx * sd.y - dy * sd.x) < 0.01;
  const directObstacles = [...scene.rects].map(([id, r]) => id === source || id === target ? unpad(r) : r);
  if (facing && !segmentBlocked(a, b, directObstacles)) return geometry([a, b]);
  const sourceOthers = [...scene.rects].filter(([id]) => id !== source).map(([, r]) => r);
  const targetOthers = [...scene.rects].filter(([id]) => id !== target).map(([, r]) => r);
  const maximum = 26 + (lane % 5) * 4;
  const se = escapeDistance(a, sd, maximum, sourceOthers), te = escapeDistance(b, td, maximum, targetOthers);
  const start = { x: a.x + sd.x * se, y: a.y + sd.y * se }, end = { x: b.x + td.x * te, y: b.y + td.y * te };
  const escapes = !segmentBlocked(a, start, sourceOthers) && !segmentBlocked(end, b, targetOthers);
  const middle = escapes ? orthogonalRoute(start, end, scene.obstacles, lane % 7) : null;
  if (middle) return geometry([a, ...middle, b]);
  // A bounded visible fallback is marked honestly, not reported as obstacle-free.
  const x = (a.x + b.x) / 2;
  return geometry([a, { x, y: a.y }, { x, y: b.y }, b], true);
}

type Entry = { scene: RoutingScene; key: string; geometry: ConnectorGeometry; bounds: RouteRect };
/** Per-canvas bounded memo; unchanged routes survive unrelated node movement. */
export class GraphRouteCache {
  private entries = new Map<string, Entry>();
  computations = 0;
  hits = 0;
  resolve(scene: RoutingScene, request: ConnectorRequest): ConnectorGeometry {
    const key = JSON.stringify([request.source, request.target, request.a.x, request.a.y, request.b.x, request.b.y, request.sourceSide, request.targetSide, scene.lanes.get(request.id)]);
    const old = this.entries.get(request.id);
    if (old?.key === key && (old.scene === scene || (!old.geometry.blocked && !changedRects(old.scene, scene).some((r) => intersects(old.bounds, r))))) {
      this.hits++; this.entries.set(request.id, { ...old, scene }); return old.geometry;
    }
    this.computations++;
    const result = computeConnectorRoute(scene, request), xs = result.points.map((p) => p.x), ys = result.points.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    this.entries.delete(request.id);
    this.entries.set(request.id, { scene, key, geometry: result, bounds: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y } });
    if (this.entries.size > 400) this.entries.delete(this.entries.keys().next().value!);
    return result;
  }
}
