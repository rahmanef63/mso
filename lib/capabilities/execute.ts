import { audit } from "@/lib/host/audit-api";
import { maybeAutoTitleAgentSession } from "@/lib/agent/session-store";
import { touchLocalAgentPresence } from "@/lib/agent/local-agent-presence";
import { activeWorkflowForActor, recordWorkflowStep } from "@/lib/workflow";
import { allows, type Scope } from "./scope";
import type { CapabilityRuntime } from "./runtime";
import type { CapabilityTool } from "./tool";
import { activityTarget, newActivityId, recordCapabilityActivity } from "./activity";
import { recipeActor, workflowActor, type CapabilityAgentContext } from "./actors";
import { capabilityRateLimited } from "./rate-limit";
import { flowFields, recordAgentEvent, sessionDetail, workflowFromResult } from "./execution-support";

export interface CapabilityExecutionContext extends CapabilityAgentContext {
  capabilities?: CapabilityRuntime;
}

export type CapabilityExecutionResult =
  | { kind: "protocol_error"; code: number; message: string }
  | { kind: "error"; message: string }
  | { kind: "success"; result: unknown };

/**
 * One execution authority for every adapter. Scope, required arguments, workflow
 * correlation, rate limiting, audit/activity and session telemetry are enforced
 * here once; transports only serialize the returned outcome.
 */
export async function executeCapabilityCall(input: {
  tool: CapabilityTool;
  args: Record<string, unknown>;
  scope: Scope;
  actor?: string;
  context?: CapabilityExecutionContext;
}): Promise<CapabilityExecutionResult> {
  const { tool, args, scope, actor, context } = input;
  const name = tool.name;
  const presence = context?.principal?.startsWith("mcp-") && context.sessionId
    ? { principal: context.principal, sessionId: context.sessionId, instanceId: `mcp:${context.sessionId}` }
    : null;
  if (presence)
    await touchLocalAgentPresence(presence.principal, presence.sessionId, "ready", presence.instanceId).catch(() => undefined);

  const workflowProbe = name === "workflow_status";
  const requestedWorkflowId = typeof args.workflow_id === "string" && args.workflow_id ? args.workflow_id : undefined;
  const flowActor = workflowActor(actor, context), learnedActor = recipeActor(actor, context);
  const lifecycle = name === "workflow_finish" || name === "workflow_cancel";
  const activeWorkflow = requestedWorkflowId ? await activeWorkflowForActor(flowActor, requestedWorkflowId) : null;
  const initialFlow = flowFields(activeWorkflow), target = activityTarget(args);

  if (!allows(scope, tool.scope)) {
    void audit({ action: "mcp.denied", actor, target: name, ok: false, detail: `scope ${scope} < ${tool.scope}` });
    const activityId = newActivityId();
    if (!workflowProbe) {
      void recordCapabilityActivity({ id: activityId, actor, tool: name, state: "denied", scope, ...initialFlow, target, detail: `scope ${scope} < ${tool.scope}` });
      await recordWorkflowStep(flowActor, activeWorkflow?.id, { id: activityId, tool: name, state: "denied", target, args, ts: new Date().toISOString() });
      await recordAgentEvent(context, name, "denied", args, activeWorkflow?.id, target);
    }
    return { kind: "error", message: `error: this token holds scope "${scope}"; ${name} needs "${tool.scope}".` };
  }

  for (const key of tool.inputSchema.required ?? []) {
    if (args[key] != null) continue;
    const activityId = newActivityId(), detail = `${name} needs { ${(tool.inputSchema.required ?? []).join(", ")} }`;
    if (!workflowProbe) {
      void recordCapabilityActivity({ id: activityId, actor, tool: name, state: "invalid_args", scope, ...initialFlow, target, detail });
      await recordWorkflowStep(flowActor, activeWorkflow?.id, { id: activityId, tool: name, state: "invalid_args", target, args, ts: new Date().toISOString() });
      await recordAgentEvent(context, name, "invalid_args", args, activeWorkflow?.id, target);
    }
    return { kind: "protocol_error", code: -32602, message: detail };
  }

  if (requestedWorkflowId && !lifecycle && !workflowProbe && name !== "workflow_start" && name !== "skills_search" && !activeWorkflow) {
    const activityId = newActivityId(), message = "workflow_id was not found for this MSO session";
    void recordCapabilityActivity({ id: activityId, actor, tool: name, state: "failed", scope, target, detail: message });
    await recordAgentEvent(context, name, "failed", args, undefined, target);
    return { kind: "error", message: `error: ${message}. Use this conversation's exact workflow_id.` };
  }

  if (capabilityRateLimited(tool, args, actor)) {
    void audit({ action: "mcp.denied", actor, target: name, ok: false, detail: "rate limited" });
    const activityId = newActivityId();
    if (!workflowProbe) {
      void recordCapabilityActivity({ id: activityId, actor, tool: name, state: "rate_limited", scope, ...initialFlow, target, detail: "rate limited" });
      await recordWorkflowStep(flowActor, activeWorkflow?.id, { id: activityId, tool: name, state: "rate_limited", target, args, ts: new Date().toISOString() });
      await recordAgentEvent(context, name, "rate_limited", args, activeWorkflow?.id, target);
    }
    return { kind: "error", message: `error: ${name} is rate limited.` };
  }

  const trail = tool.audit, auditTarget = trail?.targetArg != null ? String(args[trail.targetArg] ?? "") : undefined;
  const activityId = newActivityId(), startedAt = Date.now();
  if (!workflowProbe) void recordCapabilityActivity({ id: activityId, actor, tool: name, state: "started", scope, ...initialFlow, target });
  try {
    if (presence)
      await touchLocalAgentPresence(
        presence.principal,
        presence.sessionId,
        name === "local_agent_inbox" ? "idle" : "busy",
        presence.instanceId,
      ).catch(() => undefined);
    const titleHint = sessionDetail(name, args, target);
    if (titleHint && context?.principal && context.sessionId && !["agent_session_current", "workflow_status", "agent_subagent_run"].includes(name))
      await maybeAutoTitleAgentSession(context.principal, context.sessionId, titleHint).catch(() => undefined);

    const result = await tool.run(args, {
      actor,
      principal: context?.principal,
      sessionId: context?.sessionId,
      scope,
      workflowId: activeWorkflow?.id,
      workflowActor: flowActor,
      recipeActor: learnedActor,
      capabilities: context?.capabilities,
      toolProfile: context?.toolProfile,
    });
    if (trail) {
      const outcome = trail.outcome?.(result);
      void audit({ action: outcome?.action ?? trail.action, actor, target: auditTarget, ok: outcome?.ok ?? true, detail: outcome?.detail, meta: { via: "mcp", scope } });
    }
    const durationMs = Date.now() - startedAt, completedWorkflow = workflowFromResult(result) ?? activeWorkflow;
    if (!workflowProbe) {
      void recordCapabilityActivity({ id: activityId, actor, tool: name, state: "completed", scope, ...flowFields(completedWorkflow), target, durationMs });
      await recordWorkflowStep(flowActor, completedWorkflow?.id, { id: activityId, tool: name, state: "completed", target, args, durationMs, ts: new Date().toISOString() });
      await recordAgentEvent(context, name, "completed", args, completedWorkflow?.id, target);
    }
    if (presence)
      await touchLocalAgentPresence(presence.principal, presence.sessionId, "idle", presence.instanceId).catch(() => undefined);
    return { kind: "success", result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error), durationMs = Date.now() - startedAt;
    if (trail) void audit({ action: trail.action, actor, target: auditTarget, ok: false, detail: message.slice(0, 200), meta: { via: "mcp", scope } });
    if (!workflowProbe) {
      void recordCapabilityActivity({ id: activityId, actor, tool: name, state: "failed", scope, ...initialFlow, target, durationMs, detail: message.slice(0, 220) });
      await recordWorkflowStep(flowActor, activeWorkflow?.id, { id: activityId, tool: name, state: "failed", target, args, durationMs, ts: new Date().toISOString() });
      await recordAgentEvent(context, name, "failed", args, activeWorkflow?.id, target);
    }
    if (presence)
      await touchLocalAgentPresence(presence.principal, presence.sessionId, "idle", presence.instanceId).catch(() => undefined);
    return { kind: "error", message: "error: " + message.slice(0, 500) };
  }
}
