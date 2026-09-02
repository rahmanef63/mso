import { appendAgentSessionEvent } from "@/lib/agent/session-store";
import type { ActiveWorkflow } from "@/lib/skills/memory";
import type { CapabilityAgentContext } from "./actors";

export function sessionDetail(name: string, args: Record<string, unknown>, target?: string): string | undefined {
  if (name === "workflow_start") {
    const intent = typeof args.intent === "string" ? args.intent.slice(0, 320) : "";
    const project = typeof args.project === "string" ? args.project.slice(0, 120) : "";
    return [intent, project ? `project=${project}` : ""].filter(Boolean).join(" · ") || undefined;
  }
  if (name === "workflow_finish") return typeof args.summary === "string" ? args.summary.slice(0, 400) : target;
  if (name === "workflow_cancel") return typeof args.reason === "string" ? args.reason.slice(0, 300) : target;
  return target || undefined;
}

export async function recordAgentEvent(
  context: CapabilityAgentContext | undefined,
  tool: string,
  state: string,
  args: Record<string, unknown>,
  workflowId?: string,
  target?: string,
): Promise<void> {
  if (!context?.principal || !context.sessionId) return;
  await appendAgentSessionEvent(context.principal, context.sessionId, {
    kind: tool.startsWith("workflow_") ? "workflow" : "tool",
    tool, state, workflowId, detail: sessionDetail(tool, args, target),
  }).catch(() => undefined);
}

export function flowFields(workflow: ActiveWorkflow | null | undefined) {
  return workflow ? { workflowId: workflow.id, workflowIntent: workflow.intent, workflowProject: workflow.project } : {};
}

export function workflowFromResult(result: unknown): ActiveWorkflow | null {
  if (!result || typeof result !== "object") return null;
  const workflow = (result as { workflow?: unknown }).workflow;
  if (!workflow || typeof workflow !== "object") return null;
  const row = workflow as Partial<ActiveWorkflow>;
  return typeof row.id === "string" && typeof row.intent === "string" ? row as ActiveWorkflow : null;
}

