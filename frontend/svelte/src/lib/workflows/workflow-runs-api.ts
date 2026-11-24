import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";
import { ApiError, type WorkflowRunState, type WorkflowRunTriggerType } from "./workflows-api.ts";
import type { WorkflowRunDetail, WorkflowRunNodeDetail, WorkflowRunNodeState } from "./workflow-types.ts";

const RUN_STATES = new Set<WorkflowRunState>(["running", "completed", "completed_with_errors", "failed", "interrupted"]);
const RUN_NODE_STATES = new Set<WorkflowRunNodeState>(["queued", "running", "completed", "failed", "skipped", "blocked"]);
const TRIGGER_TYPES = new Set<WorkflowRunTriggerType>(["manual", "schedule", "webhook", "channel", "system"]);

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function statusMessage(status: number, label: string): string {
  if (status === 401) return "Your session is unavailable. Sign in and retry.";
  if (status === 403) return "This device does not have permission for this workflow action.";
  if (status === 404) return `${label} was not found.`;
  if (status === 409) return "Workflow changed on the server. Refresh before retrying.";
  if (status === 429) return "Too many workflow requests. Wait a moment and retry.";
  if (status === 502 || status === 503) return `${label} service is temporarily unavailable.`;
  return `${label} request failed (${status}).`;
}

export async function workflowRequestJson(
  path: string,
  init: { method: "GET" | "POST"; body?: Record<string, unknown> },
  label: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
  bridge: ShellBridge,
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetcher(resolveApiUrl(path, bridge), {
    method: init.method,
    credentials: bridge.apiBaseOrigin ? "include" : "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status, label), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new ApiError(`The MSO ${label.toLowerCase()} response is invalid.`, 502);
  }
  if (!response.ok) {
    if (response.status === 400 && isRecord(parsed) && typeof parsed.error === "string" && parsed.error.length <= 180) {
      throw new ApiError(parsed.error, 400);
    }
    throw new ApiError(statusMessage(response.status, label), response.status);
  }
  return parsed;
}

export function parseRunDetail(item: unknown): WorkflowRunDetail {
  if (!isRecord(item) || !isNonEmpty(item.id) || !isNonEmpty(item.graphId) || !isNonEmpty(item.graphName)
      || !RUN_STATES.has(item.state as WorkflowRunState)
      || !isNonEmpty(item.startedAt) || !isNonEmpty(item.updatedAt)) {
    throw new ApiError("The MSO workflow run response is invalid.", 502);
  }
  const triggerType = isRecord(item.trigger) && TRIGGER_TYPES.has(item.trigger.type as WorkflowRunTriggerType)
    ? (item.trigger.type as WorkflowRunTriggerType)
    : null;
  const rawNodes = Array.isArray(item.nodes) ? item.nodes : [];
  const nodes: WorkflowRunNodeDetail[] = rawNodes.filter(isRecord).map((n, idx) => ({
    id: isNonEmpty(n.id) ? n.id : `node-${idx}`,
    name: isNonEmpty(n.name) ? n.name : `Step ${idx + 1}`,
    type: isNonEmpty(n.type) ? n.type : "tool",
    state: RUN_NODE_STATES.has(n.state as WorkflowRunNodeState) ? (n.state as WorkflowRunNodeState) : "queued",
    ...(typeof n.startedAt === "string" ? { startedAt: n.startedAt } : {}),
    ...(typeof n.finishedAt === "string" ? { finishedAt: n.finishedAt } : {}),
    ...(typeof n.durationMs === "number" && Number.isFinite(n.durationMs) ? { durationMs: n.durationMs } : {}),
    ...(n.input !== undefined ? { input: n.input } : {}),
    ...(n.output !== undefined ? { output: n.output } : {}),
    ...(typeof n.error === "string" ? { error: n.error } : {}),
    logs: Array.isArray(n.logs) ? n.logs.filter((l): l is string => typeof l === "string") : [],
    ...(typeof n.attempts === "number" ? { attempts: n.attempts } : {}),
  }));
  return {
    id: item.id,
    graphId: item.graphId,
    graphRevision: typeof item.graphRevision === "string" ? item.graphRevision : "",
    graphName: item.graphName,
    state: item.state as WorkflowRunState,
    startedAt: item.startedAt,
    updatedAt: item.updatedAt,
    finishedAt: typeof item.finishedAt === "string" ? item.finishedAt : null,
    failedNodeId: typeof item.failedNodeId === "string" ? item.failedNodeId : null,
    failedNodeName: typeof item.failedNodeName === "string" ? item.failedNodeName : null,
    error: typeof item.error === "string" ? item.error : null,
    triggerType,
    nodes,
  };
}

export async function runWorkflowGraphApi(
  graphId: string, expectedRevision: string | undefined, input: Record<string, unknown>,
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<WorkflowRunDetail> {
  const body: Record<string, unknown> = {
    action: "run",
    graph_id: graphId,
    input,
    idempotency_key: `studio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  if (expectedRevision && /^[a-f0-9]{64}$/.test(expectedRevision)) body.expected_revision = expectedRevision;
  const payload = await workflowRequestJson("/api/v1/workflows", { method: "POST", body }, "Run workflow", signal, fetcher, bridge);
  return parseRunDetail(payload);
}

export async function readWorkflowRunDetailApi(
  runId: string, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<WorkflowRunDetail> {
  const path = `/api/v1/workflows?run_id=${encodeURIComponent(runId)}`;
  const payload = await workflowRequestJson(path, { method: "GET" }, "Workflow run", signal, fetcher, bridge);
  return parseRunDetail(payload);
}

export async function stopWorkflowRunApi(
  runId: string, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<WorkflowRunDetail> {
  const payload = await workflowRequestJson(
    "/api/v1/workflows", { method: "POST", body: { action: "run_stop", run_id: runId } }, "Stop run", signal, fetcher, bridge,
  );
  return parseRunDetail(payload);
}

export async function retryWorkflowRunApi(
  runId: string, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<WorkflowRunDetail> {
  const payload = await workflowRequestJson(
    "/api/v1/workflows",
    { method: "POST", body: { action: "run_retry", run_id: runId, idempotency_key: `retry-${Date.now()}` } },
    "Retry run", signal, fetcher, bridge,
  );
  return parseRunDetail(payload);
}

export async function deleteWorkflowRunApi(
  runId: string, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<void> {
  await workflowRequestJson(
    "/api/v1/workflows", { method: "POST", body: { action: "run_delete", run_id: runId } }, "Delete run", signal, fetcher, bridge,
  );
}
