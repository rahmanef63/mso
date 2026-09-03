import { audit } from "@/lib/host";
import { maybeAutoTitleAgentSession } from "@/lib/agent/session-store";
import { touchLocalAgentPresence } from "@/lib/agent/local-agent-presence";
import { activeWorkflowForActor, recordWorkflowStep } from "@/lib/skills/memory";
import { activityTarget, newActivityId, recordMcpActivity } from "./activity";
import { allows, type Scope } from "./scope";
import { TOOLS_BY_NAME } from "./tools";
import { toolAllowedForProfile } from "./tool-contract";
import { rpcFail, rpcOk, type McpAgentContext, type RpcRequest } from "./dispatch-types";
import { recipeActor, workflowActor } from "./dispatch-actors";
import { flowFields, recordAgentEvent, sessionDetail, structuredResult, workflowFromResult } from "./dispatch-tool-support";
import { toolRateLimited } from "./tool-rate-limit";

export async function dispatchToolCall(req: RpcRequest, scope: Scope, actor?: string, context?: McpAgentContext) {
  const id = req.id ?? null;
  const name = String(req.params?.name ?? ""), args = req.params?.arguments ?? {};
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool || !toolAllowedForProfile(name, context?.toolProfile ?? "full")) return rpcFail(id, -32602, `unknown tool: ${name}`);
  const mcpPresence = context?.principal?.startsWith("mcp-") && context.sessionId
    ? { principal: context.principal, sessionId: context.sessionId, instanceId: `mcp:${context.sessionId}` }
    : null;
  if (mcpPresence)
    await touchLocalAgentPresence(mcpPresence.principal, mcpPresence.sessionId, "ready", mcpPresence.instanceId).catch(() => undefined);

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
      void recordMcpActivity({ id: activityId, actor, tool: name, state: "denied", scope, ...initialFlow, target, detail: `scope ${scope} < ${tool.scope}` });
      await recordWorkflowStep(flowActor, activeWorkflow?.id, { id: activityId, tool: name, state: "denied", target, args, ts: new Date().toISOString() });
      await recordAgentEvent(context, name, "denied", args, activeWorkflow?.id, target);
    }
    return rpcOk(id, { content: [{ type: "text", text: `error: this token holds scope "${scope}"; ${name} needs "${tool.scope}".` }], isError: true });
  }

  for (const key of tool.inputSchema.required ?? []) {
    if (args[key] != null) continue;
    const activityId = newActivityId(), detail = `${name} needs { ${(tool.inputSchema.required ?? []).join(", ")} }`;
    if (!workflowProbe) {
      void recordMcpActivity({ id: activityId, actor, tool: name, state: "invalid_args", scope, ...initialFlow, target, detail });
      await recordWorkflowStep(flowActor, activeWorkflow?.id, { id: activityId, tool: name, state: "invalid_args", target, args, ts: new Date().toISOString() });
      await recordAgentEvent(context, name, "invalid_args", args, activeWorkflow?.id, target);
    }
    return rpcFail(id, -32602, detail);
  }
  if (requestedWorkflowId && !lifecycle && !workflowProbe && name !== "workflow_start" && name !== "skills_search" && !activeWorkflow) {
    const activityId = newActivityId(), message = "workflow_id was not found for this MSO session";
    void recordMcpActivity({ id: activityId, actor, tool: name, state: "failed", scope, target, detail: message });
    await recordAgentEvent(context, name, "failed", args, undefined, target);
    return rpcOk(id, { content: [{ type: "text", text: `error: ${message}. Use this conversation's exact workflow_id.` }], isError: true });
  }

  if (toolRateLimited(tool, args, actor)) {
    void audit({ action: "mcp.denied", actor, target: name, ok: false, detail: "rate limited" });
    const activityId = newActivityId();
    if (!workflowProbe) {
      void recordMcpActivity({ id: activityId, actor, tool: name, state: "rate_limited", scope, ...initialFlow, target, detail: "rate limited" });
      await recordWorkflowStep(flowActor, activeWorkflow?.id, { id: activityId, tool: name, state: "rate_limited", target, args, ts: new Date().toISOString() });
      await recordAgentEvent(context, name, "rate_limited", args, activeWorkflow?.id, target);
    }
    return rpcOk(id, { content: [{ type: "text", text: `error: ${name} is rate limited.` }], isError: true });
  }

  const trail = tool.audit, auditTarget = trail?.targetArg != null ? String(args[trail.targetArg] ?? "") : undefined;
  const activityId = newActivityId(), startedAt = Date.now();
  if (!workflowProbe) void recordMcpActivity({ id: activityId, actor, tool: name, state: "started", scope, ...initialFlow, target });
  try {
    if (mcpPresence)
      await touchLocalAgentPresence(
        mcpPresence.principal,
        mcpPresence.sessionId,
        name === "local_agent_inbox" ? "idle" : "busy",
        mcpPresence.instanceId,
      ).catch(() => undefined);
    const titleHint = sessionDetail(name, args, target);
    if (titleHint && context?.principal && context.sessionId && !["agent_session_current", "workflow_status", "agent_subagent_run"].includes(name)) {
      await maybeAutoTitleAgentSession(context.principal, context.sessionId, titleHint).catch(() => undefined);
    }
    const result = await tool.run(args, {
      actor, principal: context?.principal, sessionId: context?.sessionId, scope,
      workflowId: activeWorkflow?.id, workflowActor: flowActor, recipeActor: learnedActor, toolProfile: context?.toolProfile,
    });
    if (trail) {
      const outcome = trail.outcome?.(result);
      void audit({ action: outcome?.action ?? trail.action, actor, target: auditTarget, ok: outcome?.ok ?? true, detail: outcome?.detail, meta: { via: "mcp", scope } });
    }
    const durationMs = Date.now() - startedAt, completedWorkflow = workflowFromResult(result) ?? activeWorkflow;
    if (!workflowProbe) {
      void recordMcpActivity({ id: activityId, actor, tool: name, state: "completed", scope, ...flowFields(completedWorkflow), target, durationMs });
      await recordWorkflowStep(flowActor, completedWorkflow?.id, { id: activityId, tool: name, state: "completed", target, args, durationMs, ts: new Date().toISOString() });
      await recordAgentEvent(context, name, "completed", args, completedWorkflow?.id, target);
    }
    if (mcpPresence)
      await touchLocalAgentPresence(mcpPresence.principal, mcpPresence.sessionId, "idle", mcpPresence.instanceId).catch(() => undefined);
    return rpcOk(id, structuredResult(name, result, context?.toolProfile ?? "full"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error), durationMs = Date.now() - startedAt;
    if (trail) void audit({ action: trail.action, actor, target: auditTarget, ok: false, detail: message.slice(0, 200), meta: { via: "mcp", scope } });
    if (!workflowProbe) {
      void recordMcpActivity({ id: activityId, actor, tool: name, state: "failed", scope, ...initialFlow, target, durationMs, detail: message.slice(0, 220) });
      await recordWorkflowStep(flowActor, activeWorkflow?.id, { id: activityId, tool: name, state: "failed", target, args, durationMs, ts: new Date().toISOString() });
      await recordAgentEvent(context, name, "failed", args, activeWorkflow?.id, target);
    }
    if (mcpPresence)
      await touchLocalAgentPresence(mcpPresence.principal, mcpPresence.sessionId, "idle", mcpPresence.instanceId).catch(() => undefined);
    return rpcOk(id, { content: [{ type: "text", text: "error: " + message.slice(0, 500) }], isError: true });
  }
}
