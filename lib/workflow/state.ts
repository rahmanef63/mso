import type { ActiveWorkflow, WorkflowStoreState } from "./types";

const WORKFLOW_LEASE_MS = 6 * 60 * 60_000;

export function actorKey(actor?: string): string {
  if (!actor) throw new Error("workflow memory needs an authenticated MCP actor");
  return actor;
}

const workflowIsStale = (workflow: ActiveWorkflow): boolean =>
  Date.now() - new Date(workflow.startedAt).getTime() > WORKFLOW_LEASE_MS;

export function pruneStaleWorkflows(store: WorkflowStoreState, actor: string): boolean {
  const bucket = store.active[actor];
  if (!bucket) return false;
  let changed = false;
  for (const [id, workflow] of Object.entries(bucket)) {
    if (!workflowIsStale(workflow)) continue;
    delete bucket[id];
    changed = true;
  }
  if (!Object.keys(bucket).length) delete store.active[actor];
  return changed;
}

export function workflowFor(store: WorkflowStoreState, actor: string, workflowId: string): ActiveWorkflow | undefined {
  return store.active[actor]?.[workflowId];
}

export function removeActiveWorkflow(store: WorkflowStoreState, actor: string, workflowId: string): void {
  const bucket = store.active[actor];
  if (!bucket) return;
  delete bucket[workflowId];
  if (!Object.keys(bucket).length) delete store.active[actor];
}
