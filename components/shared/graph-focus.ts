export type GraphFocusEdge = { source: string; target: string };

type GraphFocusOptions = {
  depth?: number;
  maxNodes?: number;
  fallbackLimit?: number;
};

export function graphEntryNodeIds(nodeIds: string[], edges: GraphFocusEdge[], limit = 1): string[] {
  const visible = new Set(nodeIds);
  const incoming = new Set(
    edges
      .filter((edge) => visible.has(edge.source) && visible.has(edge.target))
      .map((edge) => edge.target),
  );
  const roots = nodeIds.filter((id) => !incoming.has(id));
  return (roots.length ? roots : nodeIds).slice(0, Math.max(1, limit));
}

/** Return a deterministic, bounded focus cluster around seeds using direct relationships in either direction. */
export function graphFocusClusterIds(
  nodeIds: string[],
  edges: GraphFocusEdge[],
  seedIds: string[] = [],
  options: GraphFocusOptions = {},
): string[] {
  if (!nodeIds.length) return [];
  const depth = Math.max(0, Math.floor(options.depth ?? 1));
  const maxNodes = Math.max(1, Math.floor(options.maxNodes ?? 12));
  const fallbackLimit = Math.max(1, Math.floor(options.fallbackLimit ?? 1));
  const visible = new Set(nodeIds);
  const seeds = [...new Set(seedIds)].filter((id) => visible.has(id));
  const initial = seeds.length ? seeds : graphEntryNodeIds(nodeIds, edges, fallbackLimit);
  const result: string[] = [];
  const seen = new Set<string>();
  let frontier = initial;

  for (let level = 0; level <= depth && frontier.length && result.length < maxNodes; level += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      if (!visible.has(id) || seen.has(id)) continue;
      seen.add(id);
      result.push(id);
      if (result.length >= maxNodes) break;
      for (const edge of edges) {
        const neighbor = edge.source === id ? edge.target : edge.target === id ? edge.source : null;
        if (neighbor && visible.has(neighbor) && !seen.has(neighbor) && !next.includes(neighbor)) next.push(neighbor);
      }
    }
    frontier = next;
  }

  return result;
}
