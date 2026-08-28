import { audit, rateLimited } from "@/lib/host";
import { activeWorkflowForActor, recordWorkflowStep, type ActiveWorkflow } from "@/lib/skills/memory";
import { activityTarget, newActivityId, recordMcpActivity } from "./activity";
import { allows, type Scope } from "./scope";
import { isMcpDirectResult } from "./tool-kit";
import { MCP_SERVER_VERSION, toolsetInfo } from "./toolset";
import { TOOLS, TOOLS_BY_NAME } from "./tools";

export interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string };
}

const PROTOCOL = "2024-11-05";
export const UNAUTHORIZED = -32001;
export const RATE_LIMITED = -32029;

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
  ...(tool.annotations ? { annotations: tool.annotations } : {}),
  ...(tool.meta ? { _meta: tool.meta } : {}),
}));

function instructions(scope: Scope): string {
  const startup = scope === "read"
    ? "This token is read-only: use skills_search for capability discovery, then bounded read tools. Verify the answer without attempting workflow memory writes."
    : "For any task needing two or more operational calls, call workflow_start directly as the ONE startup call; it already searches trusted skills and recipes, resolves the project, and reports the current toolset. Multiple workflows may run in parallel on one token. Use workflow_finish or workflow_cancel with the exact id, and pass that workflow_id on every operational call in its run; omit it for standalone work. Verify before workflow_finish.";
  return `${startup} Prefer bounded tools for one or two direct operations. At exec scope, use one narrow exec_run batch for short repository-wide search/git checks; use exec_job_start + exec_job_status for tests/builds that may exceed 30 seconds. Show concise progress using badges such as [Skills], [Files], [Terminal], [Git], [Build], [Verify], and [Screenshot]; never expose private chain-of-thought.`;
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

export async function dispatch(req: RpcRequest, scope: Scope, actor?: string): Promise<Record<string, unknown>> {
  const id = req.id ?? null;
  switch (req.method) {
    case "initialize": {
      const toolset = toolsetInfo(visibleTools(scope), scope);
      return ok(id, {
        protocolVersion: req.params?.protocolVersion ?? PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "mso", version: MCP_SERVER_VERSION },
        instructions: instructions(scope),
        _meta: { toolset },
      });
    }
    case "notifications/initialized":
    case "ping":
      return ok(id, {});
    case "tools/list": {
      const tools = visibleTools(scope);
      return ok(id, { tools: toolList(scope), _meta: { toolset: toolsetInfo(tools, scope) } });
    }
    case "tools/call": {
      const name = String(req.params?.name ?? "");
      const args = req.params?.arguments ?? {};
      const tool = TOOLS_BY_NAME.get(name);
      if (!tool) return fail(id, -32602, `unknown tool: ${name}`);
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
        void recordMcpActivity({ id: deniedId, actor, tool: name, state: "denied", scope, ...initialFlow, target, detail: `scope ${scope} < ${tool.scope}` });
        await recordWorkflowStep(actor, activeWorkflow?.id, { id: deniedId, tool: name, state: "denied", target, args, ts: new Date().toISOString() });
        return ok(id, {
          content: [{ type: "text", text: `error: this token holds scope "${scope}"; ${name} needs "${tool.scope}". Mint a new token in mso Settings → MCP.` }],
          isError: true,
        });
      }
      for (const key of tool.inputSchema.required ?? []) {
        if (args[key] == null) return fail(id, -32602, `${name} needs { ${(tool.inputSchema.required ?? []).join(", ")} }`);
      }
      if (requestedWorkflowId && !lifecycle && name !== "workflow_start" && name !== "skills_search" && !activeWorkflow) {
        const mismatchId = newActivityId();
        const target = activityTarget(args);
        const message = "workflow_id was not found for this MCP client";
        void recordMcpActivity({ id: mismatchId, actor, tool: name, state: "failed", scope, target, detail: message });
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
          void recordMcpActivity({ id: limitedId, actor, tool: name, state: "rate_limited", scope, ...initialFlow, target, detail: "rate limited" });
          await recordWorkflowStep(actor, activeWorkflow?.id, { id: limitedId, tool: name, state: "rate_limited", target, args, ts: new Date().toISOString() });
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
      void recordMcpActivity({ id: activityId, actor, tool: name, state: "started", scope, ...initialFlow, target });
      try {
        const result = await tool.run(args, { actor, scope, workflowId: activeWorkflow?.id });
        if (trail) {
          const outcome = trail.outcome?.(result);
          void audit({ action: outcome?.action ?? trail.action, actor, target: auditTarget, ok: outcome?.ok ?? true, detail: outcome?.detail, meta: { via: "mcp", scope } });
        }
        const durationMs = Date.now() - startedAt;
        const completedWorkflow = workflowFromResult(result) ?? activeWorkflow;
        void recordMcpActivity({ id: activityId, actor, tool: name, state: "completed", scope, ...flowFields(completedWorkflow), target, durationMs });
        await recordWorkflowStep(actor, completedWorkflow?.id, { id: activityId, tool: name, state: "completed", target, args, durationMs, ts: new Date().toISOString() });
        if (isMcpDirectResult(result)) return ok(id, { content: result.content, ...(result.isError ? { isError: true } : {}) });
        return ok(id, { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }] });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (trail) void audit({ action: trail.action, actor, target: auditTarget, ok: false, detail: message.slice(0, 200), meta: { via: "mcp", scope } });
        const durationMs = Date.now() - startedAt;
        void recordMcpActivity({ id: activityId, actor, tool: name, state: "failed", scope, ...initialFlow, target, durationMs, detail: message.slice(0, 220) });
        await recordWorkflowStep(actor, activeWorkflow?.id, { id: activityId, tool: name, state: "failed", target, args, durationMs, ts: new Date().toISOString() });
        return ok(id, { content: [{ type: "text", text: "error: " + message.slice(0, 500) }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `unknown method: ${req.method}`);
  }
}

export { fail as rpcError };
