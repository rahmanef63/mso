/** Bounded orthogonal routing against measured node rectangles; no graph mutation. */
export type RoutePoint = { x: number; y: number };
export type RouteRect = RoutePoint & { width: number; height: number };
const EPS = 0.01;
export const distance = (a: RoutePoint, b: RoutePoint) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export function segmentBlocked(a: RoutePoint, b: RoutePoint, rects: RouteRect[]): boolean {
  return rects.some((r) => Math.abs(a.x - b.x) < EPS
    ? a.x > r.x + EPS && a.x < r.x + r.width - EPS && Math.max(a.y, b.y) > r.y + EPS && Math.min(a.y, b.y) < r.y + r.height - EPS
    : Math.abs(a.y - b.y) < EPS
      ? a.y > r.y + EPS && a.y < r.y + r.height - EPS && Math.max(a.x, b.x) > r.x + EPS && Math.min(a.x, b.x) < r.x + r.width - EPS
      : true);
}
export function simplifyRoute(points: RoutePoint[]): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (const point of points) {
    if (out.length && distance(out[out.length - 1], point) < EPS) continue;
    while (out.length > 1) {
      const a = out[out.length - 2], b = out[out.length - 1];
      if ((a.x === b.x && b.x === point.x || a.y === b.y && b.y === point.y) && distance(a, point) >= distance(a, b)) out.pop(); else break;
    }
    out.push(point);
  }
  return out;
}
const clear = (points: RoutePoint[], rects: RouteRect[]) => points.slice(1).every((point, i) => !segmentBlocked(points[i], point, rects));
const length = (points: RoutePoint[]) => points.slice(1).reduce((total, p, i) => total + distance(points[i], p), 0);
type Search = { key: number; cost: number; score: number };
class Heap {
  items: Search[] = [];
  push(item: Search) { const a = this.items; a.push(item); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].score <= item.score) break; a[i] = a[p]; i = p; } a[i] = item; }
  pop() { const a = this.items, head = a[0], last = a.pop()!; if (a.length) { let i = 0; while (i * 2 + 1 < a.length) { let c = i * 2 + 1; if (c + 1 < a.length && a[c + 1].score < a[c].score) c++; if (a[c].score >= last.score) break; a[i] = a[c]; i = c; } a[i] = last; } return head; }
}
/** Fast channel candidates first; bounded A* handles multiple staggered obstacles. */
export function orthogonalRoute(start: RoutePoint, end: RoutePoint, obstacles: RouteRect[], lane = 0): RoutePoint[] | null {
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite) || obstacles.length > 400) return null;
  if (obstacles.some((r) => [start, end].some((p) => p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height))) return null;
  const gap = 6 + Math.abs(lane) * 6;
  const xs = [...new Set([start.x, end.x, (start.x + end.x) / 2 + lane * 18, ...obstacles.flatMap((r) => [r.x - gap, r.x + r.width + gap])])].sort((a, b) => a - b);
  const ys = [...new Set([start.y, end.y, (start.y + end.y) / 2 + lane * 18, ...obstacles.flatMap((r) => [r.y - gap, r.y + r.height + gap])])].sort((a, b) => a - b);
  const candidates = [
    ...xs.map((x) => [start, { x, y: start.y }, { x, y: end.y }, end]),
    ...ys.map((y) => [start, { x: start.x, y }, { x: end.x, y }, end]),
  ].map(simplifyRoute);
  const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
  const preferred = (horizontal ? (start.x + end.x) / 2 : (start.y + end.y) / 2) + lane * 18;
  const score = (points: RoutePoint[]) => length(points) + points.length * 12 + (points.length > 2 ? Math.abs((horizontal ? points[1].x : points[1].y) - preferred) * 0.08 : 0);
  candidates.sort((a, b) => score(a) - score(b));
  for (const candidate of candidates) if (clear(candidate, obstacles)) return candidate;
  const width = xs.length, point = (id: number): RoutePoint => ({ x: xs[id % width], y: ys[Math.floor(id / width)] });
  const first = ys.indexOf(start.y) * width + xs.indexOf(start.x), last = ys.indexOf(end.y) * width + xs.indexOf(end.x);
  const heap = new Heap(), costs = new Map<number, number>([[first * 3, 0]]), parents = new Map<number, number>();
  heap.push({ key: first * 3, cost: 0, score: distance(start, end) });
  let visits = 0;
  while (heap.items.length && visits++ < 12000) {
    const current = heap.pop(); if (current.cost !== costs.get(current.key)) continue;
    const cell = Math.floor(current.key / 3), direction = current.key % 3, here = point(cell);
    if (cell === last) { const points = [here]; let key = current.key; while (parents.has(key)) { key = parents.get(key)!; points.push(point(Math.floor(key / 3))); } return simplifyRoute(points.reverse()); }
    const x = cell % width, y = Math.floor(cell / width);
    const neighbors: [number, number][] = [];
    if (x > 0) neighbors.push([cell - 1, 1]); if (x + 1 < width) neighbors.push([cell + 1, 1]);
    if (y > 0) neighbors.push([cell - width, 2]); if (y + 1 < ys.length) neighbors.push([cell + width, 2]);
    for (const [next, dir] of neighbors) {
      const target = point(next); if (segmentBlocked(here, target, obstacles)) continue;
      const cost = current.cost + distance(here, target) + (direction && direction !== dir ? 18 : 0), key = next * 3 + dir;
      if (cost >= (costs.get(key) ?? Infinity)) continue;
      costs.set(key, cost); parents.set(key, current.key); heap.push({ key, cost, score: cost + distance(target, end) });
    }
  }
  return null;
}
export function routePath(points: RoutePoint[]): string { return points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" "); }
export function routeLabel(points: RoutePoint[]): RoutePoint {
  let best = 0, label = points[0];
  for (let i = 1; i < points.length; i++) { const size = distance(points[i - 1], points[i]); if (size > best) { best = size; label = { x: (points[i - 1].x + points[i].x) / 2, y: (points[i - 1].y + points[i].y) / 2 }; } }
  return label;
}
