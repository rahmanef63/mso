import type {
  MemoryEdgeKind, MemoryGraphEdge, MemoryGraphNode, MemoryNodeKind,
} from "./memory-graph-api.ts";

export type GraphLayoutName = "radial" | "web" | "layered";
export type Point = { x: number; y: number };
export type Bounds = { x: number; y: number; w: number; h: number };

export type NeighborLink = {
  nodeId: string; title: string; nodeKind: MemoryNodeKind | null;
  edgeKind: MemoryEdgeKind; resolved: boolean; direction: "out" | "in";
};

const RING_GAP = 150;
const LAYER_GAP = 210;
const LAYER_ROW = 68;

/** Breadth-first ring distance from the highest degree node, so layouts stay deterministic. */
export function ringDepths(nodes: MemoryGraphNode[], edges: MemoryGraphEdge[]) {
  const adjacency = new Map<string, string[]>(nodes.map((node) => [node.id, []] as const));
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }
  const pivot = [...nodes].sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))[0]?.id ?? null;
  const ring = new Map<string, number>();
  if (pivot) {
    ring.set(pivot, 0);
    const queue = [pivot];
    for (let index = 0; index < queue.length; index++) {
      const next = (ring.get(queue[index]!) ?? 0) + 1;
      for (const neighbor of adjacency.get(queue[index]!) ?? []) {
        if (ring.has(neighbor)) continue;
        ring.set(neighbor, next);
        queue.push(neighbor);
      }
    }
  }
  let max = 0;
  for (const value of ring.values()) max = Math.max(max, value);
  for (const node of nodes) if (!ring.has(node.id)) ring.set(node.id, pivot ? max + 1 : 0);
  return { pivot, ring };
}

function buckets(nodes: MemoryGraphNode[], edges: MemoryGraphEdge[]) {
  const { ring } = ringDepths(nodes, edges);
  const grouped = new Map<number, MemoryGraphNode[]>();
  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    const hop = ring.get(node.id) ?? 0;
    grouped.set(hop, [...(grouped.get(hop) ?? []), node]);
  }
  return grouped;
}

function placeRadial(nodes: MemoryGraphNode[], edges: MemoryGraphEdge[]): Map<string, Point> {
  const points = new Map<string, Point>();
  for (const [hop, bucket] of buckets(nodes, edges)) {
    bucket.forEach((node, index) => {
      if (hop === 0) { points.set(node.id, { x: 0, y: 0 }); return; }
      const angle = (Math.PI * 2 * index) / bucket.length - Math.PI / 2;
      points.set(node.id, { x: Math.cos(angle) * hop * RING_GAP, y: Math.sin(angle) * hop * RING_GAP });
    });
  }
  return points;
}

function placeLayered(nodes: MemoryGraphNode[], edges: MemoryGraphEdge[]): Map<string, Point> {
  const points = new Map<string, Point>();
  for (const [hop, bucket] of buckets(nodes, edges)) {
    bucket.forEach((node, index) => {
      points.set(node.id, { x: hop * LAYER_GAP, y: (index - (bucket.length - 1) / 2) * LAYER_ROW });
    });
  }
  return points;
}

/** Deterministic relaxation: same input always yields the same coordinates. */
function placeWeb(nodes: MemoryGraphNode[], edges: MemoryGraphEdge[]): Map<string, Point> {
  const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const positions = ordered.map((_node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(ordered.length, 1);
    const radius = 80 + ordered.length * 4;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
  const indexOf = new Map(ordered.map((node, index) => [node.id, index]));
  for (let iter = 0; iter < 60; iter++) {
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]!, b = positions[j]!;
        let dx = a.x - b.x, dy = a.y - b.y;
        let dist = Math.hypot(dx, dy) || 0.01;
        if (dist < 16) { dx = (i - j) || 1; dy = 1; dist = Math.hypot(dx, dy); }
        const force = 900 / (dist * dist);
        a.x += (dx / dist) * force; a.y += (dy / dist) * force;
        b.x -= (dx / dist) * force; b.y -= (dy / dist) * force;
      }
    }
    for (const edge of edges) {
      const a = positions[indexOf.get(edge.source) ?? -1];
      const b = positions[indexOf.get(edge.target) ?? -1];
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const pull = (dist - 160) * 0.04;
      a.x += (dx / dist) * pull; a.y += (dy / dist) * pull;
      b.x -= (dx / dist) * pull; b.y -= (dy / dist) * pull;
    }
    for (const point of positions) { point.x *= 0.98; point.y *= 0.98; }
  }
  return new Map(ordered.map((node, index) => [node.id, positions[index]!]));
}

export function placeNodes(
  nodes: MemoryGraphNode[], edges: MemoryGraphEdge[], layout: GraphLayoutName,
): Map<string, Point> {
  if (layout === "radial") return placeRadial(nodes, edges);
  if (layout === "layered") return placeLayered(nodes, edges);
  return placeWeb(nodes, edges);
}

export function computeBounds(points: Map<string, Point>): Bounds {
  const values = [...points.values()];
  if (values.length === 0) return { x: -100, y: -100, w: 200, h: 200 };
  const xs = values.map((point) => point.x), ys = values.map((point) => point.y);
  const minX = Math.min(...xs) - 90, minY = Math.min(...ys) - 70;
  return { x: minX, y: minY, w: Math.max(...xs) - minX + 180, h: Math.max(...ys) - minY + 160 };
}

/** Group tint stays inside the shipped palette: accent mixed toward the border color. */
export function groupColor(group: string, groups: string[]): string {
  const index = Math.max(0, groups.indexOf(group));
  const mix = 30 + (index % 5) * 14;
  return `color-mix(in srgb, var(--accent) ${mix}%, var(--panel-solid))`;
}

/** Nodes reachable within `depth` hops, used by the focus mode. */
export function neighbourhood(edges: MemoryGraphEdge[], focusId: string, depth: number): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
  }
  const seen = new Set<string>([focusId]);
  let frontier = [focusId];
  for (let hop = 0; hop < Math.max(1, depth); hop++) {
    const next: string[] = [];
    for (const id of frontier) for (const near of adjacency.get(id) ?? []) if (!seen.has(near)) { seen.add(near); next.push(near); }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return seen;
}
