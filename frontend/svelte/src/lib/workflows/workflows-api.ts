import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export { ApiError };
export type { ShellBridge };

export type WorkflowGraphStatus = "draft" | "active" | "archived";
export type WorkflowRunState = "running" | "completed" | "completed_with_errors" | "failed" | "interrupted";
export type WorkflowRunTriggerType = "manual" | "schedule" | "webhook" | "channel" | "system";
export type WorkflowsTab = "graphs" | "runs";

export type WorkflowGraphSummary = {
  id: string; name: string; description: string; status: WorkflowGraphStatus;
  nodeCount: number; edgeCount: number; tags: string[];
  folder: string | null; project: string | null;
  createdAt: string; updatedAt: string; revision: string;
};

export type WorkflowRunSummary = {
  id: string; graphId: string; graphRevision: string; graphName: string;
  state: WorkflowRunState; startedAt: string; updatedAt: string; finishedAt: string | null;
  failedNodeId: string | null; failedNodeName: string | null; triggerType: WorkflowRunTriggerType | null;
};

export type WorkflowRunsPage = { runs: WorkflowRunSummary[]; total: number; nextOffset?: number };

export type WorkflowsState =
  | { kind: "loading"; tab: WorkflowsTab }
  | { kind: "ready"; tab: WorkflowsTab; graphs: WorkflowGraphSummary[]; runs: WorkflowRunSummary[]; totalRuns: number }
  | { kind: "error"; tab: WorkflowsTab; message: string };

const GRAPH_STATUSES = new Set<WorkflowGraphStatus>(["draft", "active", "archived"]);
const RUN_STATES = new Set<WorkflowRunState>(["running", "completed", "completed_with_errors", "failed", "interrupted"]);
const TRIGGER_TYPES = new Set<WorkflowRunTriggerType>(["manual", "schedule", "webhook", "channel", "system"]);

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isOptNullStr = (v: unknown): v is string | null | undefined => v === undefined || v === null || typeof v === "string";

function statusMessage(status: number, label: string): string {
  if (status === 401) return "Your session is unavailable. Sign in and retry.";
  if (status === 403) return "This device does not have permission to view workflows.";
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  if (status === 502 || status === 503) return `${label} service is temporarily unavailable. Retry when ready.`;
  return `${label} request failed (${status}).`;
}

async function fetchJson(
  path: string, label: string, signal: AbortSignal, fetcher: typeof fetch, bridge: ShellBridge,
): Promise<unknown> {
  const response = await fetcher(resolveApiUrl(path, bridge), {
    method: "GET", credentials: bridge.apiBaseOrigin ? "include" : "same-origin", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), headers: { Accept: "application/json" },
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status, label), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status, label), response.status);
  try { return await response.json(); } catch {
    throw new ApiError(`The MSO ${label.toLowerCase()} response is invalid.`, 502);
  }
}

function validateGraph(item: unknown): WorkflowGraphSummary {
  if (!isRecord(item) || !isNonEmpty(item.id) || !isNonEmpty(item.name) || typeof item.description !== "string"
      || !GRAPH_STATUSES.has(item.status as WorkflowGraphStatus)
      || !Array.isArray(item.nodes) || !Array.isArray(item.edges)
      || !isNonEmpty(item.createdAt) || !isNonEmpty(item.updatedAt) || !isNonEmpty(item.revision)
      || (item.version !== undefined && item.version !== 2)) {
    throw new ApiError("The MSO workflows response is invalid.", 502);
  }
  const meta = item.metadata;
  if (meta !== undefined && !isRecord(meta)) throw new ApiError("The MSO workflows response is invalid.", 502);
  const rawTags = meta?.tags;
  if (rawTags !== undefined && (!Array.isArray(rawTags) || !rawTags.every((t) => typeof t === "string"))) {
    throw new ApiError("The MSO workflows response is invalid.", 502);
  }
  if (!isOptNullStr(meta?.folder) || !isOptNullStr(meta?.project)) {
    throw new ApiError("The MSO workflows response is invalid.", 502);
  }
  return {
    id: item.id, name: item.name, description: item.description, status: item.status as WorkflowGraphStatus,
    nodeCount: item.nodes.length, edgeCount: item.edges.length,
    tags: rawTags ? rawTags.map((t) => t.trim()).filter(Boolean) : [],
    folder: meta?.folder?.trim() || null, project: meta?.project?.trim() || null,
    createdAt: item.createdAt, updatedAt: item.updatedAt, revision: item.revision,
  };
}

function validateRun(item: unknown): WorkflowRunSummary {
  if (!isRecord(item) || !isNonEmpty(item.id) || !isNonEmpty(item.graphId) || !isNonEmpty(item.graphName)
      || !RUN_STATES.has(item.state as WorkflowRunState)
      || !isNonEmpty(item.startedAt) || !isNonEmpty(item.updatedAt)
      || (item.graphRevision !== undefined && typeof item.graphRevision !== "string")
      || !isOptNullStr(item.finishedAt) || !isOptNullStr(item.failedNodeId) || !isOptNullStr(item.failedNodeName)) {
    throw new ApiError("The MSO workflow runs response is invalid.", 502);
  }
  let triggerType: WorkflowRunTriggerType | null = null;
  if (item.trigger !== undefined && item.trigger !== null) {
    if (!isRecord(item.trigger) || !TRIGGER_TYPES.has(item.trigger.type as WorkflowRunTriggerType)) {
      throw new ApiError("The MSO workflow runs response is invalid.", 502);
    }
    triggerType = item.trigger.type as WorkflowRunTriggerType;
  }
  return {
    id: item.id, graphId: item.graphId, graphRevision: typeof item.graphRevision === "string" ? item.graphRevision : "",
    graphName: item.graphName, state: item.state as WorkflowRunState,
    startedAt: item.startedAt, updatedAt: item.updatedAt,
    finishedAt: item.finishedAt ?? null, failedNodeId: item.failedNodeId ?? null,
    failedNodeName: item.failedNodeName ?? null, triggerType,
  };
}

export async function readWorkflowGraphs(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<WorkflowGraphSummary[]> {
  const payload = await fetchJson("/api/v1/workflows", "Workflows", signal, fetcher, bridge);
  if (!isRecord(payload) || !Array.isArray(payload.graphs)) throw new ApiError("The MSO workflows response is invalid.", 502);
  return payload.graphs.map(validateGraph);
}

export async function readWorkflowRuns(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<WorkflowRunsPage> {
  const payload = await fetchJson("/api/v1/workflows?runs=1", "Workflow runs", signal, fetcher, bridge);
  if (Array.isArray(payload)) {
    const runs = payload.map(validateRun);
    return { runs, total: runs.length };
  }
  if (!isRecord(payload) || !Array.isArray(payload.runs)) throw new ApiError("The MSO workflow runs response is invalid.", 502);
  if (payload.total !== undefined && (typeof payload.total !== "number" || !Number.isInteger(payload.total) || payload.total < 0)) {
    throw new ApiError("The MSO workflow runs response is invalid.", 502);
  }
  if (payload.nextOffset !== undefined && (typeof payload.nextOffset !== "number" || !Number.isInteger(payload.nextOffset) || payload.nextOffset < 0)) {
    throw new ApiError("The MSO workflow runs response is invalid.", 502);
  }
  const runs = payload.runs.map(validateRun);
  return { runs, total: payload.total ?? runs.length, ...(payload.nextOffset !== undefined ? { nextOffset: payload.nextOffset } : {}) };
}

export function createWorkflowsController(
  update: (state: WorkflowsState) => void, fetcher = fetch, bridge?: ShellBridge,
) {
  let generation = 0; let active: AbortController | undefined; let disposed = false;
  let tab: WorkflowsTab = "graphs";
  let graphs: WorkflowGraphSummary[] = [];
  let runs: WorkflowRunSummary[] = [];
  let totalRuns = 0;

  async function load(targetTab: WorkflowsTab) {
    if (disposed) return;
    tab = targetTab;
    const runId = ++generation;
    active?.abort();
    const controller = (active = new AbortController());
    update({ kind: "loading", tab });
    try {
      if (tab === "graphs") {
        const nextGraphs = await readWorkflowGraphs(controller.signal, fetcher, bridge);
        if (!disposed && runId === generation) { graphs = nextGraphs; update({ kind: "ready", tab, graphs, runs, totalRuns }); }
      } else {
        const page = await readWorkflowRuns(controller.signal, fetcher, bridge);
        if (!disposed && runId === generation) { runs = page.runs; totalRuns = page.total; update({ kind: "ready", tab, graphs, runs, totalRuns }); }
      }
    } catch (error) {
      if (!disposed && runId === generation && !controller.signal.aborted) {
        update({ kind: "error", tab, message: error instanceof ApiError ? error.message : "Could not load workflows. Check the backend and retry." });
      }
    }
  }

  return {
    refresh: () => load(tab),
    setTab: (nextTab: WorkflowsTab) => load(nextTab),
    dispose() { disposed = true; generation++; active?.abort(); },
  };
}
