import { audit, rateLimited } from "@/lib/host";
import { appendAgentSessionEvent } from "@/lib/agent/session-store";
import { activeWorkflowForActor, recordWorkflowStep, type ActiveWorkflow } from "@/lib/skills/memory";
import { activityTarget, newActivityId, recordMcpActivity } from "./activity";
import { allows, type Scope } from "./scope";
import { isMcpDirectResult } from "./tool-kit";
import { MCP_SERVER_VERSION, toolsetInfo } from "./toolset";
import { TOOLS, TOOLS_BY_NAME } from "./tools";
import { listUiResources, readUiResource } from "./ui-resources";

export interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string; uri?: string };
}

const PROTOCOL = "2024-11-05";
export const UNAUTHORIZED = -32001;
export const RATE_LIMITED = -32029;

export interface McpAgentContext {
  principal?: string;
  sessionId?: string;
}

function sessionDetail(name: string, args: Record<string, unknown>, target?: string): string | undefined {
  if (name === "workflow_start") {
    const intent = typeof args.intent === "string" ? args.intent.slice(0, 320) : "";
    const project = typeof args.project === "string" ? args.project.slice(0, 120) : "";
    return [intent, project ? `project=${project}` : ""].filter(Boolean).join(" · ") || undefined;
  }
  if (name === "workflow_finish") {
    return typeof args.summary === "string" ? args.summary.slice(0, 400) : target;
  }
  if (name === "workflow_cancel") {
    return typeof args.reason === "string" ? args.reason.slice(0, 300) : target;
  }
  return target || undefined;
}

async function recordAgentEvent(
  context: McpAgentContext | undefined,
  tool: string,
  state: string,
  args: Record<string, unknown>,
  workflowId?: string,
  target?: string,
): Promise<void> {
  if (!context?.principal || !context.sessionId) return;
  await appendAgentSessionEvent(context.principal, context.sessionId, {
    kind: tool.startsWith("workflow_") ? "workflow" : "tool",
    tool,
    state,
    workflowId,
    detail: sessionDetail(tool, args, target),
  }).catch(() => undefined);
}

const ok = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: RpcRequest["id"], code: number, message: string) =>
  ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export function isNotification(body: unknown): boolean {
  const b = body as RpcRequest | null;
  return b?.id == null && String(b?.method ?? "").startsWith("notifications/");
}

const visibleTools = (scope: Scope) => TOOLS.filter((tool) => allows(scope, tool.scope));
const toolList = (scope: Scope) => visibleTools(scope).map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
  ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
  ...(tool.annotations ? { annotations: tool.annotations } : {}),
  ...(tool.meta ? { _meta: tool.meta } : {}),
}));

function instructions(scope: Scope): string {
  const startup = scope === "read"
    ? "This token is read-only: use skills_search for capability discovery, then bounded read tools. Verify the answer without attempting workflow memory writes."
    : "For any task needing two or more operational calls, call workflow_start directly as the ONE startup call; it already searches trusted skills and recipes, resolves the project, and reports the current toolset. Multiple workflows may run in parallel on one token. Use workflow_finish or workflow_cancel with the exact id, and pass that workflow_id on every operational call in its run; omit it for standalone work. Verify before workflow_finish.";
  return `${startup} Every MCP connection has a durable MSO session id. Use agent_session_current when the user asks for it; use agent_sessions_list + agent_session_resume to recover safe MSO operational context from an earlier ChatGPT conversation. Session resume does not expose ChatGPT hidden transcripts. Persistent USER.md/MEMORY.md are client-scoped and frozen into each new session. Prefer bounded tools for one or two direct operations. At exec scope, use one narrow exec_run batch for short repository-wide search/git checks; use exec_job_start + exec_job_status for tests/builds that may exceed 30 seconds. Show concise progress using badges such as [Skills], [Files], [Terminal], [Git], [Build], [Verify], and [Screenshot]; never expose private chain-of-thought.`;
}

function flowFields(workflow: ActiveWorkflow | null | undefined) {
  return workflow ? {
    workflowId: workflow.id,
    workflowIntent: workflow.intent,
    workflowProject: workflow.project,
  } : {};
}

function workflowFromResult(result: unknown): ActiveWorkflow | null {
  if (!result || typeof result !== "object") return null;
  const workflow = (result as { workflow?: unknown }).workflow;
  if (!workflow || typeof workflow !== "object") return null;
  const row = workflow as Partial<ActiveWorkflow>;
  return typeof row.id === "string" && typeof row.intent === "string"
    ? row as ActiveWorkflow
    : null;
}

function structuredResult(toolName: string, result: unknown) {
  const tool = TOOLS_BY_NAME.get(toolName);
  const content = [{ type: "text" as const, text: typeof result === "string" ? result : JSON.stringify(result) }];
  const structured = tool?.toStructuredContent
    ? tool.toStructuredContent(result)
    : result !== null && typeof result === "object" && !Array.isArray(result)
      ? result as Record<string, unknown>
      : undefined;
  return tool?.outputSchema && structured
    ? { structuredContent: structured, content }
    : { content };
}

export async function dispatch(req: RpcRequest, scope: Scope, actor?: string, agentContext?: McpAgentContext): Promise<Record<string, unknown>> {
  const id = req.id ?? null;
  switch (req.method) {
    case "initialize": {
      const toolset = toolsetInfo(visibleTools(scope), scope);
      return ok(id, {
        protocolVersion: req.params?.protocolVersion ?? PROTOCOL,
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: { name: "mso", version: MCP_SERVER_VERSION },
        instructions: instructions(scope),
        _meta: { toolset, ...(agentContext?.sessionId ? { agentSessionId: agentContext.sessionId } : {}) },
      });
    }
    case "notifications/initialized":
    case "ping":
      return ok(id, {});
    case "tools/list": {
      const tools = visibleTools(scope);
      return ok(id, { tools: toolList(scope), _meta: { toolset: toolsetInfo(tools, scope) } });
    }
    case "resources/list":
      return ok(id, { resources: listUiResources() });
    case "resources/read": {
      const uri = String(req.params?.uri ?? "");
      if (!uri) return fail(id, -32602, "resources/read needs { uri }");
      const resource = readUiResource(uri);
      if (!resource) return fail(id, -32602, `unknown resource: ${uri}`);
      return ok(id, {
        contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.text, _meta: resource._meta }],
      });
    }
    case "tools/call": {
      const name = String(req.params?.name ?? "");
      const args = req.params?.arguments ?? {};
      const tool = TOOLS_BY_NAME.get(name);
      if (!tool) return fail(id, -32602, `unknown tool: ${name}`);
      const workflowProbe = name === "workflow_status";
      const requestedWorkflowId = typeof args.workflow_id === "string" && args.workflow_id ? args.workflow_id : undefined;
      const lifecycle = name === "workflow_finish" || name === "workflow_cancel";
      const activeWorkflow = requestedWorkflowId
        ? await activeWorkflowForActor(actor, requestedWorkflowId)
        : null;
      const initialFlow = flowFields(activeWorkflow);
      if (!allows(scope, tool.scope)) {
        void audit({ action: "mcp.denied", actor, target: name, ok: false, detail: `scope ${scope} < ${tool.scope}` });
        const deniedId = newActivityId();
        const target = activityTarget(args);
        if (!workflowProbe) {
          void recordMcpActivity({ id: deniedId, actor, tool: name, state: "denied", scope, ...initialFlow, target, detail: `scope ${scope} < ${tool.scope}` });
          await recordWorkflowStep(actor, activeWorkflow?.id, { id: deniedId, tool: name, state: "denied", target, args, ts: new Date().toISOString() });
          await recordAgentEvent(agentContext, name, "denied", args, activeWorkflow?.id, target);
        }
        return ok(id, {
          content: [{ type: "text", text: `error: this token holds scope "${scope}"; ${name} needs "${tool.scope}". Mint a new token in mso Settings → MCP.` }],
          isError: true,
        });
      }
      for (const key of tool.inputSchema.required ?? []) {
        if (args[key] == null) return fail(id, -32602, `${name} needs { ${(tool.inputSchema.required ?? []).join(", ")} }`);
      }
      if (requestedWorkflowId && !lifecycle && !workflowProbe && name !== "workflow_start" && name !== "skills_search" && !activeWorkflow) {
        const mismatchId = newActivityId();
        const target = activityTarget(args);
        const message = "workflow_id was not found for this MCP client";
        void recordMcpActivity({ id: mismatchId, actor, tool: name, state: "failed", scope, target, detail: message });
        await recordAgentEvent(agentContext, name, "failed", args, undefined, target);
        return ok(id, {
          content: [{ type: "text", text: `error: ${message}. Use the exact id returned by workflow_start, or omit workflow_id for a standalone call.` }],
          isError: true,
        });
      }
      if (tool.limit) {
        const suffix = tool.limit.keyArg ? String(args[tool.limit.keyArg] ?? "") : (actor ?? "mcp");
        if (rateLimited(`${tool.limit.key}:${suffix}`, tool.limit.max, tool.limit.windowMs)) {
          void audit({ action: "mcp.denied", actor, target: name, ok: false, detail: "rate limited" });
          const limitedId = newActivityId();
          const target = activityTarget(args);
          if (!workflowProbe) {
            void recordMcpActivity({ id: limitedId, actor, tool: name, state: "rate_limited", scope, ...initialFlow, target, detail: "rate limited" });
            await recordWorkflowStep(actor, activeWorkflow?.id, { id: limitedId, tool: name, state: "rate_limited", target, args, ts: new Date().toISOString() });
            await recordAgentEvent(agentContext, name, "rate_limited", args, activeWorkflow?.id, target);
          }
          return ok(id, {
            content: [{ type: "text", text: `error: ${name} is rate limited (${tool.limit.max} per ${Math.round(tool.limit.windowMs / 1000)}s). Wait and retry.` }],
            isError: true,
          });
        }
      }

      const trail = tool.audit;
      const auditTarget = trail?.targetArg != null ? String(args[trail.targetArg] ?? "") : undefined;
      const activityId = newActivityId();
      const startedAt = Date.now();
      const target = activityTarget(args);
      if (!workflowProbe) void recordMcpActivity({ id: activityId, actor, tool: name, state: "started", scope, ...initialFlow, target });
      try {
        const result = await tool.run(args, { actor, principal: agentContext?.principal, sessionId: agentContext?.sessionId, scope, workflowId: activeWorkflow?.id });
        if (trail) {
          const outcome = trail.outcome?.(result);
          void audit({ action: outcome?.action ?? trail.action, actor, target: auditTarget, ok: outcome?.ok ?? true, detail: outcome?.detail, meta: { via: "mcp", scope } });
        }
        const durationMs = Date.now() - startedAt;
        const completedWorkflow = workflowFromResult(result) ?? activeWorkflow;
        if (!workflowProbe) {
          void recordMcpActivity({ id: activityId, actor, tool: name, state: "completed", scope, ...flowFields(completedWorkflow), target, durationMs });
          await recordWorkflowStep(actor, completedWorkflow?.id, { id: activityId, tool: name, state: "completed", target, args, durationMs, ts: new Date().toISOString() });
          await recordAgentEvent(agentContext, name, "completed", args, completedWorkflow?.id, target);
        }
        if (isMcpDirectResult(result)) return ok(id, { content: result.content, ...(result.isError ? { isError: true } : {}) });
        return ok(id, structuredResult(name, result));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (trail) void audit({ action: trail.action, actor, target: auditTarget, ok: false, detail: message.slice(0, 200), meta: { via: "mcp", scope } });
        const durationMs = Date.now() - startedAt;
        if (!workflowProbe) {
          void recordMcpActivity({ id: activityId, actor, tool: name, state: "failed", scope, ...initialFlow, target, durationMs, detail: message.slice(0, 220) });
          await recordWorkflowStep(actor, activeWorkflow?.id, { id: activityId, tool: name, state: "failed", target, args, durationMs, ts: new Date().toISOString() });
          await recordAgentEvent(agentContext, name, "failed", args, activeWorkflow?.id, target);
        }
        return ok(id, { content: [{ type: "text", text: "error: " + message.slice(0, 500) }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `unknown method: ${req.method}`);
  }
}

export { fail as rpcError };
