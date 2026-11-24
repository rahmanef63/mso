import type { WorkflowGraphSummary, WorkflowRunState, WorkflowRunSummary } from "./workflows-api.ts";
import type { WorkflowGraphDetail, WorkflowRunDetail, WorkflowRunNodeState } from "./workflow-types.ts";

export type StudioPane = "library" | "canvas" | "inspector";
export type StatusFilter = "all" | "active" | "draft" | "archived";
export type RunStateFilter = "all" | "running" | "completed" | "failed";

export function graphTone(status: WorkflowGraphSummary["status"]): "ok" | "warn" | "neutral" {
  return status === "active" ? "ok" : status === "draft" ? "warn" : "neutral";
}

export function runTone(runState: WorkflowRunState | WorkflowRunNodeState): "ok" | "warn" | "danger" | "neutral" {
  if (runState === "completed") return "ok";
  if (runState === "running" || runState === "completed_with_errors") return "warn";
  if (runState === "failed" || runState === "interrupted") return "danger";
  return "neutral";
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleString();
}

export function formatDurationMs(startedAt: string, finishedAt: string | null | undefined): string {
  if (!finishedAt) return "In progress";
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function filterGraphDetails(
  graphs: readonly WorkflowGraphDetail[],
  query: string,
  statusFilter: StatusFilter,
): WorkflowGraphDetail[] {
  const q = query.trim().toLowerCase();
  return graphs.filter((g) => {
    if (statusFilter !== "all" && g.status !== statusFilter) return false;
    if (!q) return true;
    const hay = `${g.name} ${g.id} ${g.status} ${g.description} ${(g.metadata.tags ?? []).join(" ")} ${g.metadata.project ?? ""} ${g.metadata.folder ?? ""}`;
    return hay.toLowerCase().includes(q);
  });
}

export function filterRunSummaries(
  runs: readonly WorkflowRunSummary[],
  query: string,
  stateFilter: RunStateFilter,
): WorkflowRunSummary[] {
  const q = query.trim().toLowerCase();
  return runs.filter((r) => {
    if (stateFilter === "running" && r.state !== "running") return false;
    if (stateFilter === "completed" && r.state !== "completed") return false;
    if (stateFilter === "failed" && r.state !== "failed" && r.state !== "completed_with_errors" && r.state !== "interrupted") {
      return false;
    }
    if (!q) return true;
    const hay = `${r.graphName} ${r.id} ${r.state} ${r.failedNodeName ?? ""} ${r.triggerType ?? ""}`;
    return hay.toLowerCase().includes(q);
  });
}

export function runNodeStateMap(run: WorkflowRunDetail | null, graphId: string | null): Record<string, WorkflowRunNodeState> {
  if (!run || !graphId || run.graphId !== graphId) return {};
  const map: Record<string, WorkflowRunNodeState> = {};
  for (const node of run.nodes) map[node.id] = node.state;
  return map;
}

export function formatJsonPreview(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
