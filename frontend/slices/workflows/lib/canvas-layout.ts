import type { WorkflowGraph, WorkflowGraphNode } from "@/lib/contracts/workflow-graph";

const X_GAP = 270;
const Y_GAP = 128;
const START_X = 72;
const START_Y = 72;

export function tidyWorkflowNodes(graph: WorkflowGraph): WorkflowGraphNode[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map(graph.nodes.map((node) => [node.id, graph.edges.filter((edge) => edge.target === node.id && byId.has(edge.source))]));
  const indegree = new Map(graph.nodes.map((node) => [node.id, incoming.get(node.id)?.length ?? 0]));
  const layer = new Map<string, number>();
  const queue = graph.nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).sort((a, b) => a.position.y - b.position.y || a.name.localeCompare(b.name));

  for (const node of queue) layer.set(node.id, 0);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    const currentLayer = layer.get(current.id) ?? 0;
    for (const edge of graph.edges.filter((row) => row.source === current.id && byId.has(row.target))) {
      layer.set(edge.target, Math.max(layer.get(edge.target) ?? 0, currentLayer + 1));
      const next = (indegree.get(edge.target) ?? 1) - 1;
      indegree.set(edge.target, next);
      if (next === 0) queue.push(byId.get(edge.target)!);
    }
  }

  const fallbackLayer = Math.max(0, ...layer.values()) + 1;
  for (const node of graph.nodes) if (!layer.has(node.id)) layer.set(node.id, fallbackLayer);
  const rows = new Map<number, WorkflowGraphNode[]>();
  for (const node of graph.nodes) rows.set(layer.get(node.id)!, [...(rows.get(layer.get(node.id)!) ?? []), node]);
  for (const group of rows.values()) group.sort((a, b) => a.position.y - b.position.y || a.name.localeCompare(b.name));

  return graph.nodes.map((node) => {
    const depth = layer.get(node.id)!;
    const row = rows.get(depth)!;
    const index = row.findIndex((item) => item.id === node.id);
    const yOffset = ((row.length - 1) * Y_GAP) / 2;
    return { ...node, position: { x: START_X + depth * X_GAP, y: Math.max(32, START_Y + index * Y_GAP - yOffset + 180) } };
  });
}
