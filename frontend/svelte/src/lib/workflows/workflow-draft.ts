import { tidyGraphNodes, wouldCreateCycle } from "./workflow-canvas-math.ts";
import {
  isTriggerNodeType,
  type WorkflowEdge,
  type WorkflowGraphDetail,
  type WorkflowGraphDraft,
  type WorkflowNode,
  type WorkflowNodeType,
  type WorkflowPaletteItem,
} from "./workflow-types.ts";
import { jsonClone } from "./json-clone.ts";

export function cloneDraft(draft: WorkflowGraphDraft): WorkflowGraphDraft {
  return jsonClone(draft);
}

export function draftFromDetail(detail: WorkflowGraphDetail): WorkflowGraphDraft {
  return cloneDraft({
    id: detail.id,
    name: detail.name,
    description: detail.description,
    status: detail.status,
    inputs: detail.inputs,
    nodes: detail.nodes,
    edges: detail.edges,
    metadata: detail.metadata,
  });
}

export function serializeDraft(draft: WorkflowGraphDraft): string {
  return JSON.stringify({
    name: draft.name,
    description: draft.description,
    status: draft.status,
    inputs: draft.inputs,
    nodes: draft.nodes,
    edges: draft.edges,
    metadata: draft.metadata,
  });
}

export function isDraftDirty(saved: WorkflowGraphDetail | null, draft: WorkflowGraphDraft | null): boolean {
  if (!saved || !draft) return false;
  return serializeDraft(draftFromDetail(saved)) !== serializeDraft(draft);
}

export function nextNodeId(nodes: readonly WorkflowNode[], type: WorkflowNodeType): string {
  const existing = new Set(nodes.map((n) => n.id));
  const prefix = type.replace(/[^a-z0-9]/gi, "-");
  for (let i = 1; i <= 999; i++) {
    const id = `${prefix}-${i}`;
    if (!existing.has(id)) return id;
  }
  return `${prefix}-${Date.now()}`;
}

export function nextEdgeId(edges: readonly WorkflowEdge[]): string {
  const existing = new Set(edges.map((e) => e.id));
  for (let i = 1; i <= 999; i++) {
    const id = `edge-${i}`;
    if (!existing.has(id)) return id;
  }
  return `edge-${Date.now()}`;
}

export function addNodeToDraft(
  draft: WorkflowGraphDraft,
  item: WorkflowPaletteItem,
  connectFromId?: string | null,
): { draft: WorkflowGraphDraft; node: WorkflowNode } {
  const id = nextNodeId(draft.nodes, item.type);
  const anchor = connectFromId ? draft.nodes.find((n) => n.id === connectFromId) : draft.nodes.at(-1);
  const position = anchor
    ? { x: Math.round(anchor.position.x + 240), y: Math.round(anchor.position.y) }
    : { x: 64, y: 120 };
  const node: WorkflowNode = {
    id,
    name: item.defaultName,
    type: item.type,
    position,
    config: jsonClone(item.defaults),
  };
  let nextEdges = draft.edges;
  if (anchor && !isTriggerNodeType(item.type) && anchor.type !== "output") {
    nextEdges = [
      ...draft.edges,
      {
        id: nextEdgeId(draft.edges),
        source: anchor.id,
        target: node.id,
        ...(anchor.type === "condition" ? { sourceHandle: "true" } : {}),
      },
    ];
  }
  return {
    node,
    draft: { ...draft, nodes: [...draft.nodes, node], edges: nextEdges },
  };
}

export function moveNodeInDraft(
  draft: WorkflowGraphDraft,
  nodeId: string,
  x: number,
  y: number,
): WorkflowGraphDraft {
  const rx = Math.round(x);
  const ry = Math.round(y);
  return {
    ...draft,
    nodes: draft.nodes.map((node) => (node.id === nodeId ? { ...node, position: { x: rx, y: ry } } : node)),
  };
}

export function updateNodeInDraft(
  draft: WorkflowGraphDraft,
  nodeId: string,
  patch: Partial<WorkflowNode>,
): WorkflowGraphDraft {
  return {
    ...draft,
    nodes: draft.nodes.map((node) => {
      if (node.id !== nodeId) return node;
      const merged: WorkflowNode = { ...node, ...patch };
      if (merged.type === "schedule") {
        merged.config = sanitizeScheduleConfig(merged.config);
      }
      return merged;
    }),
  };
}

function sanitizeScheduleConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const mode = raw.mode === "interval" ? "interval" : "cron";
  const tz = typeof raw.timezone === "string" && raw.timezone.trim() ? raw.timezone.trim() : "UTC";
  if (mode === "interval") {
    const mins = Number(raw.everyMinutes);
    return {
      mode: "interval",
      everyMinutes: Number.isInteger(mins) && mins >= 1 && mins <= 10080 ? mins : 60,
      timezone: tz,
    };
  }
  const cron = typeof raw.cron === "string" && raw.cron.trim() ? raw.cron.trim() : "*/15 * * * *";
  return { mode: "cron", cron, timezone: tz };
}

export function removeNodeFromDraft(draft: WorkflowGraphDraft, nodeId: string): WorkflowGraphDraft {
  return {
    ...draft,
    nodes: draft.nodes.filter((n) => n.id !== nodeId),
    edges: draft.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
  };
}

export function connectEdgeInDraft(
  draft: WorkflowGraphDraft,
  sourceId: string,
  targetId: string,
  sourceHandle?: string,
): { draft: WorkflowGraphDraft; edge?: WorkflowEdge; error?: string } {
  if (sourceId === targetId) return { draft, error: "A node cannot connect to itself." };
  const source = draft.nodes.find((n) => n.id === sourceId);
  const target = draft.nodes.find((n) => n.id === targetId);
  if (!source || !target) return { draft, error: "Both source and target nodes must exist." };
  if (isTriggerNodeType(target.type)) return { draft, error: "Trigger nodes must remain workflow roots." };
  if (source.type === "output") return { draft, error: "Output nodes cannot start outgoing edges." };
  const normalizedHandle = sourceHandle && sourceHandle !== "out" ? sourceHandle : undefined;
  const dup = draft.edges.some(
    (e) => e.source === sourceId && e.target === targetId && (e.sourceHandle ?? undefined) === normalizedHandle,
  );
  if (dup) return { draft, error: "That connection already exists." };
  if (wouldCreateCycle(draft.nodes, draft.edges, sourceId, targetId)) {
    return { draft, error: "Cyclic edges are not allowed in workflow graphs." };
  }
  const edge: WorkflowEdge = {
    id: nextEdgeId(draft.edges),
    source: sourceId,
    target: targetId,
    ...(normalizedHandle ? { sourceHandle: normalizedHandle } : {}),
  };
  return { draft: { ...draft, edges: [...draft.edges, edge] }, edge };
}

export function updateEdgeInDraft(
  draft: WorkflowGraphDraft,
  edgeId: string,
  patch: Partial<WorkflowEdge>,
): WorkflowGraphDraft {
  return {
    ...draft,
    edges: draft.edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e)),
  };
}

export function removeEdgeFromDraft(draft: WorkflowGraphDraft, edgeId: string): WorkflowGraphDraft {
  return { ...draft, edges: draft.edges.filter((e) => e.id !== edgeId) };
}

export function tidyDraftLayout(draft: WorkflowGraphDraft): WorkflowGraphDraft {
  return { ...draft, nodes: tidyGraphNodes(draft.nodes, draft.edges) };
}
