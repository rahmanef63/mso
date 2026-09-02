import { randomUUID } from "node:crypto";
import type { Scope } from "@/lib/capabilities/scope";
import type { WorkflowOrchestrationSnapshot } from "@/lib/contracts/orchestration";
import { safeMemoryText, sanitizeOrchestration, sanitizeStoredStep } from "./sanitize";
import { actorKey, pruneStaleWorkflows, removeActiveWorkflow, workflowFor } from "./state";
import { loadWorkflowStore, persistWorkflowStore } from "./storage";
import type { ActiveWorkflow, CancelWorkflowResult, WorkflowStepInput } from "./types";

const MAX_ACTIVE_PER_ACTOR = 20;

export async function startWorkflow(input: {
  actor?: string;
  scope?: Scope;
  intent: string;
  project?: string;
  constraints?: string;
  orchestration?: WorkflowOrchestrationSnapshot;
}): Promise<{ workflow: ActiveWorkflow; activeWorkflowCount: number }> {
  const actor = actorKey(input.actor);
  const scope: Scope = input.scope ?? "read";
  const intent = safeMemoryText(input.intent, 1000);
  if (!intent) throw new Error("intent must be a non-empty string");
  const store = await loadWorkflowStore();
  pruneStaleWorkflows(store, actor);
  const bucket = store.active[actor] ?? {};
  if (Object.keys(bucket).length >= MAX_ACTIVE_PER_ACTOR)
    throw new Error(`this MCP client already has ${MAX_ACTIVE_PER_ACTOR} active workflows; finish or cancel an exact workflow_id first`);
  const workflow: ActiveWorkflow = {
    id: randomUUID(), actor, scope, intent,
    project: input.project ? safeMemoryText(input.project, 240) || undefined : undefined,
    constraints: input.constraints ? safeMemoryText(input.constraints, 500) || undefined : undefined,
    orchestration: sanitizeOrchestration(input.orchestration),
    startedAt: new Date().toISOString(), steps: [],
  };
  (store.active[actor] ??= {})[workflow.id] = workflow;
  await persistWorkflowStore(store);
  return { workflow, activeWorkflowCount: Object.keys(store.active[actor]).length };
}

export async function activeWorkflowForActor(actor?: string, workflowId?: string): Promise<ActiveWorkflow | null> {
  if (!actor) return null;
  const store = await loadWorkflowStore();
  const changed = pruneStaleWorkflows(store, actor);
  const bucket = store.active[actor];
  const workflow = workflowId ? bucket?.[workflowId] ?? null : (bucket && Object.keys(bucket).length === 1 ? Object.values(bucket)[0] : null);
  if (changed) await persistWorkflowStore(store);
  return workflow;
}

export async function recordWorkflowStep(actor: string | undefined, workflowId: string | undefined, step: WorkflowStepInput): Promise<void> {
  if (!actor || !workflowId) return;
  const store = await loadWorkflowStore();
  const workflow = workflowFor(store, actor, workflowId);
  if (!workflow || ["skills_search", "workflow_start", "workflow_finish", "workflow_cancel"].includes(step.tool)) return;
  const sanitized = sanitizeStoredStep(step);
  if (!sanitized) return;
  workflow.steps.push(sanitized);
  if (workflow.steps.length > 300) workflow.steps.splice(0, workflow.steps.length - 300);
  await persistWorkflowStore(store);
}

export async function cancelWorkflow(input: { actor?: string; workflowId: string; reason?: string }): Promise<CancelWorkflowResult> {
  const actor = actorKey(input.actor);
  const store = await loadWorkflowStore();
  const workflow = workflowFor(store, actor, input.workflowId);
  if (!workflow) throw new Error("workflow_id was not found for this MSO session");
  removeActiveWorkflow(store, actor, input.workflowId);
  await persistWorkflowStore(store);
  const reason = input.reason ? safeMemoryText(input.reason, 500) || undefined : undefined;
  return { workflow, ...(reason ? { reason } : {}) };
}
