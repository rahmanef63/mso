import { neighbourhood } from "@/lib/memory-graph/assemble";
import type { MemoryGraphDocument, MemoryGraphEdge, MemoryGraphNode } from "@/lib/memory-graph/types";

export interface ViewOptions {
  query: string;
  showGhosts: boolean;
  showTags: boolean;
  showOrphans: boolean;
  local: boolean;
  depth: number;
  focusId: string | null;
  hiddenGroups: string[];
}

function withDegree(nodes: MemoryGraphNode[], edges: MemoryGraphEdge[]): MemoryGraphNode[] {
  const degree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return nodes.map((node) => ({ ...node, degree: degree.get(node.id) ?? 0 }));
}

export function viewGraph(graph: MemoryGraphDocument, options: ViewOptions): MemoryGraphDocument {
  let nodes = graph.nodes.filter((node) => !options.hiddenGroups.includes(node.group));
  if (!options.showGhosts) nodes = nodes.filter((node) => node.kind !== "ghost");
  if (!options.showTags) nodes = nodes.filter((node) => node.kind !== "tag");
  const kept = new Set(nodes.map((node) => node.id));
  let edges = graph.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target));

  if (options.local && nodes.length) {
    const focus = options.focusId && kept.has(options.focusId)
      ? options.focusId
      : [...nodes].sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))[0]!.id;
    const near = neighbourhood(edges, focus, options.depth);
    nodes = nodes.filter((node) => near.has(node.id));
    const ids = new Set(nodes.map((node) => node.id));
    edges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  }

  const query = options.query.trim().toLowerCase();
  if (query) {
    nodes = nodes.filter((node) => `${node.title} ${node.group} ${node.excerpt ?? ""}`.toLowerCase().includes(query));
    const ids = new Set(nodes.map((node) => node.id));
    edges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  }

  nodes = withDegree(nodes, edges);
  if (!options.showOrphans) {
    nodes = nodes.filter((node) => node.degree > 0 || node.kind === "folder");
    const ids = new Set(nodes.map((node) => node.id));
    edges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    nodes = withDegree(nodes, edges);
  }
  return { ...graph, nodes, edges };
}
