import type { MemoryGraphEdge, MemoryGraphNode } from "@/lib/memory-graph/types";

export type GraphLayoutName = "web" | "radial" | "layered";
export interface Point { x: number; y: number }

function hops(nodes: MemoryGraphNode[], edges: MemoryGraphEdge[]) {
  const adj = new Map<string, string[]>();
  for (const node of nodes) adj.set(node.id, []);
  for (const edge of edges) {
    adj.get(edge.source)?.push(edge.target);
    adj.get(edge.target)?.push(edge.source);
  }
  const pivot = [...nodes].sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))[0]?.id ?? null;
  const ring = new Map<string, number>();
  if (pivot) {
    ring.set(pivot, 0);
    const queue = [pivot];
    for (let index = 0; index < queue.length; index++) {
      const nextHop = (ring.get(queue[index]!) ?? 0) + 1;
      for (const neighbor of adj.get(queue[index]!) ?? []) {
        if (ring.has(neighbor)) continue;
        ring.set(neighbor, nextHop);
        queue.push(neighbor);
      }
    }
  }
  let max = 0;
  for (const value of ring.values()) max = Math.max(max, value);
  for (const node of nodes) if (!ring.has(node.id)) ring.set(node.id, max + 1);
  return { pivot, ring };
}

function placeRadial(nodes: MemoryGraphNode[], edges: MemoryGraphEdge[]): Map<string, Point> {
  const { ring } = hops(nodes, edges);
  const buckets = new Map<number, MemoryGraphNode[]>();
  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    const hop = ring.get(node.id) ?? 0;
    buckets.set(hop, [...(buckets.get(hop) ?? []), node]);
  }
  const points = new Map<string, Point>();
  for (const [hop, bucket] of buckets) {
    bucket.forEach((node, index) => {
      if (hop === 0) { points.set(node.id, { x: 0, y: 0 }); return; }
      const angle = (Math.PI * 2 * index) / bucket.length - Math.PI / 2;
      points.set(node.id, { x: Math.cos(angle) * hop * 150, y: Math.sin(angle) * hop * 150 });
    });
  }
  return points;
}

function placeLayered(nodes: MemoryGraphNode[], edges: MemoryGraphEdge[]): Map<string, Point> {
  const { ring } = hops(nodes, edges);
  const buckets = new Map<number, MemoryGraphNode[]>();
  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    const hop = ring.get(node.id) ?? 0;
    buckets.set(hop, [...(buckets.get(hop) ?? []), node]);
  }
  const points = new Map<string, Point>();
  for (const [hop, bucket] of buckets) {
    bucket.forEach((node, index) => {
      points.set(node.id, { x: hop * 210, y: (index - (bucket.length - 1) / 2) * 68 });
    });
  }
  return points;
}

function placeWeb(nodes: MemoryGraphNode[], edges: MemoryGraphEdge[]): Map<string, Point> {
  const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const pos = ordered.map((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(ordered.length, 1);
    const radius = 80 + ordered.length * 4;
    return { id: node.id, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
  const indexOf = new Map(pos.map((point, index) => [point.id, index]));
  for (let iter = 0; iter < 60; iter++) {
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const a = pos[i]!, b = pos[j]!;
        let dx = a.x - b.x, dy = a.y - b.y;
        let dist = Math.hypot(dx, dy) || 0.01;
        if (dist < 16) { dx = (i - j) || 1; dy = 1; dist = Math.hypot(dx, dy); }
        const force = 900 / (dist * dist);
        const ux = dx / dist, uy = dy / dist;
        a.x += ux * force; a.y += uy * force;
        b.x -= ux * force; b.y -= uy * force;
      }
    }
    for (const edge of edges) {
      const a = pos[indexOf.get(edge.source) ?? -1];
      const b = pos[indexOf.get(edge.target) ?? -1];
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const pull = (dist - 160) * 0.04;
      a.x += (dx / dist) * pull; a.y += (dy / dist) * pull;
      b.x -= (dx / dist) * pull; b.y -= (dy / dist) * pull;
    }
    for (const point of pos) { point.x *= 0.98; point.y *= 0.98; }
  }
  return new Map(pos.map((point) => [point.id, { x: point.x, y: point.y }]));
}

export function placeNodes(nodes: MemoryGraphNode[], edges: MemoryGraphEdge[], layout: GraphLayoutName): Map<string, Point> {
  if (layout === "radial") return placeRadial(nodes, edges);
  if (layout === "layered") return placeLayered(nodes, edges);
  return placeWeb(nodes, edges);
}

export function groupColor(group: string, groups: string[]): string {
  const index = Math.max(0, groups.indexOf(group));
  const mix = 22 + (index % 6) * 12;
  return `color-mix(in srgb, var(--accent) ${mix}%, var(--foreground))`;
}
