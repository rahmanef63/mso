import { detectShellBridge, type ShellBridge } from "../shell-bridge.ts";
import { ApiError, type WorkflowGraphStatus, type WorkflowGraphSummary } from "./workflows-api.ts";
import { synthesizeStudioGraph } from "./workflow-canvas-math.ts";
import { workflowRequestJson } from "./workflow-runs-api.ts";
import {
  WORKFLOW_NODE_TYPES,
  type WorkflowEdge,
  type WorkflowGraphDetail,
  type WorkflowGraphDraft,
  type WorkflowMetadata,
  type WorkflowNode,
  type WorkflowNodeType,
} from "./workflow-types.ts";

export {
  deleteWorkflowRunApi,
  readWorkflowRunDetailApi,
  retryWorkflowRunApi,
  runWorkflowGraphApi,
  stopWorkflowRunApi,
} from "./workflow-runs-api.ts";
import { jsonClone } from "./json-clone.ts";

const GRAPH_STATUSES = new Set<WorkflowGraphStatus>(["draft", "active", "archived"]);
const NODE_TYPE_SET = new Set<string>(WORKFLOW_NODE_TYPES);
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function parseNode(raw: unknown, index: number): WorkflowNode | null {
  if (!isRecord(raw) || !isNonEmpty(raw.id)) return null;
  if (!isNonEmpty(raw.name) || typeof raw.type !== "string" || !NODE_TYPE_SET.has(raw.type)) return null;
  const pos = isRecord(raw.position) ? raw.position : null;
  const x = pos && typeof pos.x === "number" && Number.isFinite(pos.x) ? pos.x : 48 + index * 240;
  const y = pos && typeof pos.y === "number" && Number.isFinite(pos.y) ? pos.y : 120;
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type as WorkflowNodeType,
    position: { x, y },
    config: isRecord(raw.config) ? jsonClone(raw.config) : {},
    ...(raw.disabled === true ? { disabled: true } : {}),
  };
}

function parseEdge(raw: unknown, nodeIds: Set<string>): WorkflowEdge | null {
  if (!isRecord(raw) || !isNonEmpty(raw.id) || !isNonEmpty(raw.source) || !isNonEmpty(raw.target)) return null;
  if (!nodeIds.has(raw.source) || !nodeIds.has(raw.target)) return null;
  return {
    id: raw.id,
    source: raw.source,
    target: raw.target,
    ...(isNonEmpty(raw.sourceHandle) ? { sourceHandle: raw.sourceHandle } : {}),
    ...(isNonEmpty(raw.targetHandle) ? { targetHandle: raw.targetHandle } : {}),
    ...(raw.style === "dashed" || raw.style === "solid" ? { style: raw.style } : {}),
    ...(raw.disabled === true ? { disabled: true } : {}),
  };
}

export function normalizeGraphDetail(item: unknown): WorkflowGraphDetail {
  if (!isRecord(item) || !isNonEmpty(item.id) || !isNonEmpty(item.name) || typeof item.description !== "string"
      || !GRAPH_STATUSES.has(item.status as WorkflowGraphStatus)
      || !Array.isArray(item.nodes) || !Array.isArray(item.edges)
      || !isNonEmpty(item.createdAt) || !isNonEmpty(item.updatedAt) || !isNonEmpty(item.revision)) {
    throw new ApiError("The MSO workflows response is invalid.", 502);
  }
  const metaRaw = isRecord(item.metadata) ? item.metadata : {};
  const tags = Array.isArray(metaRaw.tags)
    ? metaRaw.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean)
    : [];
  const metadata: WorkflowMetadata = {
    ...(tags.length ? { tags } : {}),
    ...(typeof metaRaw.folder === "string" && metaRaw.folder.trim() ? { folder: metaRaw.folder.trim() } : {}),
    ...(typeof metaRaw.project === "string" && metaRaw.project.trim() ? { project: metaRaw.project.trim() } : {}),
    ...(typeof metaRaw.timezone === "string" && metaRaw.timezone.trim() ? { timezone: metaRaw.timezone.trim() } : {}),
    ...(typeof metaRaw.errorWorkflowId === "string" && metaRaw.errorWorkflowId.trim()
      ? { errorWorkflowId: metaRaw.errorWorkflowId.trim() } : {}),
  };

  const parsedNodes = item.nodes.map((n, i) => parseNode(n, i)).filter((n): n is WorkflowNode => n !== null);
  let nodes: WorkflowNode[];
  let edges: WorkflowEdge[];
  if (parsedNodes.length === item.nodes.length && item.nodes.length > 0) {
    nodes = parsedNodes;
    const nodeIds = new Set(nodes.map((n) => n.id));
    edges = item.edges.map((e) => parseEdge(e, nodeIds)).filter((e): e is WorkflowEdge => e !== null);
  } else {
    const synthesized = synthesizeStudioGraph({
      name: item.name,
      status: item.status as WorkflowGraphStatus,
      nodeCount: item.nodes.length,
      edgeCount: item.edges.length,
    });
    nodes = synthesized.nodes;
    edges = synthesized.edges;
  }

  return {
    version: 2,
    id: item.id,
    name: item.name,
    description: item.description,
    status: item.status as WorkflowGraphStatus,
    inputs: isRecord(item.inputs) ? jsonClone(item.inputs) : {},
    nodes,
    edges,
    metadata,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    revision: item.revision,
  };
}

export function summaryFromDetail(detail: WorkflowGraphDetail): WorkflowGraphSummary {
  return {
    id: detail.id,
    name: detail.name,
    description: detail.description,
    status: detail.status,
    nodeCount: detail.nodes.length,
    edgeCount: detail.edges.length,
    tags: detail.metadata.tags ? [...detail.metadata.tags] : [],
    folder: detail.metadata.folder ?? null,
    project: detail.metadata.project ?? null,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    revision: detail.revision,
  };
}

export async function readWorkflowGraphDetails(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<WorkflowGraphDetail[]> {
  const payload = await workflowRequestJson("/api/v1/workflows", { method: "GET" }, "Workflows", signal, fetcher, bridge);
  if (!isRecord(payload) || !Array.isArray(payload.graphs)) throw new ApiError("The MSO workflows response is invalid.", 502);
  return payload.graphs.map(normalizeGraphDetail);
}

export async function createWorkflowGraphApi(
  draft: WorkflowGraphDraft, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<WorkflowGraphDetail> {
  const payload = await workflowRequestJson(
    "/api/v1/workflows", { method: "POST", body: { action: "create", graph: draft } }, "Create workflow", signal, fetcher, bridge,
  );
  if (!isRecord(payload) || !payload.graph) throw new ApiError("The MSO create workflow response is invalid.", 502);
  return normalizeGraphDetail(payload.graph);
}

export async function updateWorkflowGraphApi(
  graphId: string, expectedRevision: string, draft: WorkflowGraphDraft,
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<WorkflowGraphDetail> {
  const { id: _ignored, ...definition } = draft;
  const payload = await workflowRequestJson("/api/v1/workflows", {
    method: "POST",
    body: { action: "update", graph_id: graphId, expected_revision: expectedRevision, graph: definition },
  }, "Save workflow", signal, fetcher, bridge);
  if (!isRecord(payload) || !payload.graph) throw new ApiError("The MSO save workflow response is invalid.", 502);
  return normalizeGraphDetail(payload.graph);
}

export async function cloneWorkflowGraphApi(
  graphId: string, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<WorkflowGraphDetail> {
  const payload = await workflowRequestJson(
    "/api/v1/workflows", { method: "POST", body: { action: "clone", graph_id: graphId } }, "Duplicate workflow", signal, fetcher, bridge,
  );
  if (!isRecord(payload) || !payload.graph) throw new ApiError("The MSO duplicate workflow response is invalid.", 502);
  return normalizeGraphDetail(payload.graph);
}

export async function deleteWorkflowGraphApi(
  graphId: string, expectedRevision: string, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<void> {
  await workflowRequestJson("/api/v1/workflows", {
    method: "POST", body: { action: "delete", graph_id: graphId, expected_revision: expectedRevision },
  }, "Delete workflow", signal, fetcher, bridge);
}
