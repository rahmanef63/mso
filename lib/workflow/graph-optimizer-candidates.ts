import type { GraphCustomNode } from "@/lib/contracts/graph-custom-nodes";
import type { WorkflowGraph, WorkflowGraphEdge, WorkflowGraphNode } from "@/lib/contracts/workflow-graph";
import type { CapabilityTool } from "@/lib/capabilities/tool";
import type { WorkflowOptimizerCandidate } from "./graph-optimizer";

export type InternalOptimizerCandidate = WorkflowOptimizerCandidate & {
  apply: (graph: WorkflowGraph) => WorkflowGraph;
};

const ACTION_TYPES = new Set<WorkflowGraphNode["type"]>([
  "tool", "project_function", "project_mcp", "integration", "channel_send", "script", "agent", "subflow",
  "project", "folder", "skill", "knowledge", "cache", "data_table", "memory", "session", "directory",
]);

const cloneGraph = (graph: WorkflowGraph): WorkflowGraph => structuredClone(graph);

function referencedNodeIds(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const child of value) referencedNodeIds(child, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "$ref" && typeof child === "string") {
      const match = /^nodes\.([A-Za-z0-9_.:-]+)(?:\.|$)/.exec(child);
      if (match) out.add(match[1]!);
    } else referencedNodeIds(child, out);
  }
  return out;
}

function allReferencedNodeIds(graph: WorkflowGraph): Set<string> {
  const out = new Set<string>();
  for (const node of graph.nodes) referencedNodeIds(node.config, out);
  return out;
}

function simpleChain(graph: WorkflowGraph): WorkflowGraphNode[] | null {
  const enabledEdges = graph.edges.filter((edge) => !edge.disabled);
  const incoming = new Map<string, WorkflowGraphEdge[]>();
  const outgoing = new Map<string, WorkflowGraphEdge[]>();
  for (const node of graph.nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of enabledEdges) {
    incoming.get(edge.target)?.push(edge);
    outgoing.get(edge.source)?.push(edge);
  }
  const roots = graph.nodes.filter((node) => (incoming.get(node.id)?.length ?? 0) === 0);
  if (roots.length !== 1) return null;
  const ordered: WorkflowGraphNode[] = [], visited = new Set<string>();
  let current: WorkflowGraphNode | undefined = roots[0];
  while (current) {
    if (visited.has(current.id)) return null;
    visited.add(current.id); ordered.push(current);
    const edges: WorkflowGraphEdge[] = outgoing.get(current.id) ?? [];
    if (edges.length > 1 || edges.some((edge) => edge.sourceHandle || edge.targetHandle)) return null;
    if (!edges.length) break;
    const next: WorkflowGraphNode | undefined = graph.nodes.find((node) => node.id === edges[0]!.target);
    if (!next || (incoming.get(next.id)?.length ?? 0) !== 1) return null;
    current = next;
  }
  return visited.size === graph.nodes.length ? ordered : null;
}

function addPresentationGroup(graph: WorkflowGraph, group: GraphCustomNode): WorkflowGraph {
  const next = cloneGraph(graph), groups = next.metadata.customNodes ?? [];
  const assigned = new Set(groups.flatMap((row) => row.nodeIds));
  const members = group.nodeIds.filter((id) => next.nodes.some((node) => node.id === id) && !assigned.has(id));
  if (members.length < 3) return next;
  next.metadata.customNodes = [...groups, { ...group, nodeIds: members }];
  return next;
}

function presentationCandidates(graph: WorkflowGraph): InternalOptimizerCandidate[] {
  const chain = simpleChain(graph);
  if (!chain) return [];
  const assigned = new Set((graph.metadata.customNodes ?? []).flatMap((group) => group.nodeIds));
  if (chain.filter((node) => ACTION_TYPES.has(node.type) && !assigned.has(node.id)).length < 4) return [];
  const chunks: WorkflowGraphNode[][] = [];
  let chunk: WorkflowGraphNode[] = [];
  for (const node of chain) {
    if (ACTION_TYPES.has(node.type) && !assigned.has(node.id)) { chunk.push(node); continue; }
    if (chunk.length >= 4) chunks.push(chunk);
    chunk = [];
  }
  if (chunk.length >= 4) chunks.push(chunk);
  return chunks.slice(0, 12).map((nodes, index) => {
    const id = `group-${index + 1}-${nodes[0]!.id}`.slice(0, 96);
    const group: GraphCustomNode = {
      id: `optimized:${id}`.slice(0, 96),
      name: nodes.length > 6 ? `Action block · ${nodes.length} steps` : nodes.map((node) => node.name).join(" → ").slice(0, 120),
      nodeIds: nodes.map((node) => node.id),
      collapsed: true,
    };
    return {
      id: `presentation:${index + 1}`, kind: "presentation-group", title: `Collapse ${nodes.length} related steps`,
      description: "Presentation-only grouping. Execution nodes, edges, arguments and receipts remain unchanged.",
      nodeIds: group.nodeIds, risk: "safe", estimatedNodeDelta: 0, hostEligible: true,
      apply: (current: WorkflowGraph) => addPresentationGroup(current, group),
    };
  });
}

const isPlainArguments = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

function exactToolConfig(node: WorkflowGraphNode): { tool: string; arguments: Record<string, unknown> } | null {
  if (node.type !== "tool" || node.disabled) return null;
  if (Object.keys(node.config).some((key) => !["tool", "arguments"].includes(key))) return null;
  if (typeof node.config.tool !== "string" || !node.config.tool) return null;
  const args = node.config.arguments ?? {};
  if (!isPlainArguments(args) || referencedNodeIds(node.config).size) return null;
  return { tool: node.config.tool, arguments: structuredClone(args) };
}

function replaceRunWithLoop(graph: WorkflowGraph, nodes: WorkflowGraphNode[], tool: string): WorkflowGraph {
  const next = cloneGraph(graph), ids = new Set(nodes.map((node) => node.id));
  const firstId = nodes[0]!.id, lastId = nodes.at(-1)!.id;
  const configs = nodes.map((node) => exactToolConfig(node)!.arguments);
  next.nodes = next.nodes
    .filter((node) => !ids.has(node.id) || node.id === firstId)
    .map((node) => node.id === firstId ? {
      ...node, name: `Loop · ${tool} × ${configs.length}`.slice(0, 120), type: "loop" as const,
      config: { tool, items: configs, arguments: { $item: true }, concurrency: 1 },
    } : node);
  next.edges = next.edges
    .filter((edge) => !(ids.has(edge.source) && ids.has(edge.target)))
    .filter((edge) => !ids.has(edge.target) || edge.target === firstId)
    .filter((edge) => !ids.has(edge.source) || edge.source === firstId || edge.source === lastId)
    .map((edge) => edge.source === lastId ? { ...edge, source: firstId } : edge);
  if (next.metadata.customNodes) next.metadata.customNodes = next.metadata.customNodes
    .map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => !ids.has(id) || id === firstId) }))
    .filter((group) => group.nodeIds.length > 0);
  return next;
}

function loopCandidates(graph: WorkflowGraph, resolveTool?: (name: string) => CapabilityTool | undefined): InternalOptimizerCandidate[] {
  const chain = simpleChain(graph);
  if (!chain) return [];
  const referenced = allReferencedNodeIds(graph), result: InternalOptimizerCandidate[] = [];
  for (let i = 0; i < chain.length;) {
    const first = exactToolConfig(chain[i]!);
    if (!first) { i += 1; continue; }
    const tool = resolveTool?.(first.tool);
    if (resolveTool && (!tool || tool.annotations?.readOnlyHint !== true)) { i += 1; continue; }
    let end = i + 1;
    while (end < chain.length) {
      const config = exactToolConfig(chain[end]!);
      if (!config || config.tool !== first.tool) break;
      end += 1;
    }
    const nodes = chain.slice(i, end);
    if (nodes.length >= 3 && nodes.every((node) => !referenced.has(node.id))) {
      result.push({
        id: `loop:${result.length + 1}`, kind: "loop-compaction", title: `Compact ${nodes.length} × ${first.tool} into one loop`,
        description: "Preserves call order with concurrency=1 and exact prepared arguments. Runtime result shape changes from per-node outputs to one loop result, so review is required.",
        nodeIds: nodes.map((node) => node.id), risk: "review", estimatedNodeDelta: 1 - nodes.length, hostEligible: true,
        apply: (current: WorkflowGraph) => replaceRunWithLoop(current, nodes, first.tool),
      });
    }
    i = Math.max(end, i + 1);
  }
  return result.slice(0, 12);
}

export function workflowOptimizerCandidates(
  graph: WorkflowGraph,
  resolveTool?: (name: string) => CapabilityTool | undefined,
): InternalOptimizerCandidate[] {
  return [...presentationCandidates(graph), ...loopCandidates(graph, resolveTool)];
}
