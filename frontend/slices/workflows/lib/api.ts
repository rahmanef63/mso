import type { WorkflowGraph, WorkflowGraphRun } from "@/lib/contracts/workflow-graph";

async function json<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `request failed (${response.status})`);
  return body as T;
}

export async function listGraphs(): Promise<WorkflowGraph[]> { return (await json<{ graphs: WorkflowGraph[] }>("/api/v1/workflows")).graphs; }
export async function getGraph(id: string): Promise<WorkflowGraph> { return (await json<{ graph: WorkflowGraph }>(`/api/v1/workflows?graph_id=${encodeURIComponent(id)}`)).graph; }
export async function createGraph(graph: unknown): Promise<WorkflowGraph> { return (await json<{ graph: WorkflowGraph }>("/api/v1/workflows", { method: "POST", body: JSON.stringify({ action: "create", graph }) })).graph; }
export async function updateGraph(graph: WorkflowGraph): Promise<WorkflowGraph> {
  const { revision, createdAt: _createdAt, updatedAt: _updatedAt, version: _version, ...definition } = graph;
  return (await json<{ graph: WorkflowGraph }>("/api/v1/workflows", { method: "POST", body: JSON.stringify({ action: "update", graph_id: graph.id, expected_revision: revision, graph: definition }) })).graph;
}
export async function deleteGraph(graph: WorkflowGraph): Promise<void> { await json("/api/v1/workflows", { method: "POST", body: JSON.stringify({ action: "delete", graph_id: graph.id, expected_revision: graph.revision }) }); }
export async function cloneGraph(id: string): Promise<WorkflowGraph> { return (await json<{ graph: WorkflowGraph }>("/api/v1/workflows", { method: "POST", body: JSON.stringify({ action: "clone", graph_id: id }) })).graph; }
export async function runGraph(id: string): Promise<WorkflowGraphRun & { pollAfterMs?: number }> { return json("/api/v1/workflows", { method: "POST", body: JSON.stringify({ action: "run", graph_id: id, input: {}, idempotency_key: `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }) }); }
export async function runStatus(id: string): Promise<WorkflowGraphRun & { pollAfterMs?: number }> { return json(`/api/v1/workflows?run_id=${encodeURIComponent(id)}&wait_ms=1500`); }
export async function resolveNode(graphId: string, nodeId: string): Promise<{ project: string; name: string; path: string; relativePath: string }> { return json(`/api/v1/workflows?graph_id=${encodeURIComponent(graphId)}&node_id=${encodeURIComponent(nodeId)}&resolve=target`); }
