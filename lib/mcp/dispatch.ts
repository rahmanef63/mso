import { allows, type Scope } from "./scope";
import { MCP_SERVER_VERSION, toolsetInfo } from "./toolset";
import { TOOLS } from "./tools";
import { listUiResources, readUiResource } from "./ui-resources";
import { dispatchToolCall } from "./dispatch-tools";
import { rpcFail, rpcOk, type McpAgentContext, type RpcRequest } from "./dispatch-types";
export type { McpAgentContext, RpcRequest } from "./dispatch-types";

const PROTOCOL = "2024-11-05";
export const UNAUTHORIZED = -32001;
export const RATE_LIMITED = -32029;

export function isNotification(body: unknown): boolean {
  const b = body as RpcRequest | null;
  return b?.id == null && String(b?.method ?? "").startsWith("notifications/");
}

const visibleTools = (scope: Scope) => TOOLS.filter((tool) => allows(scope, tool.scope));
const toolList = (scope: Scope) => visibleTools(scope).map((tool) => ({
  name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
  ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
  ...(tool.annotations ? { annotations: tool.annotations } : {}),
  ...(tool.meta ? { _meta: tool.meta } : {}),
}));

function instructions(scope: Scope): string {
  const startup = scope === "read"
    ? "This token is read-only: use skills_search for capability discovery, then bounded read tools."
    : "For multi-step work call workflow_start once, pass its exact workflow_id on every operation in this conversation, verify, then workflow_finish or workflow_cancel.";
  return `${startup} ChatGPT conversation identity is isolated from OAuth/audit identity; workflows are session-scoped while learned successful recipes remain client-scoped. agent_session_current exposes only the current durable MSO session. Use agent_sessions_list and agent_session_resume for explicit recovery. Session context has an estimated-token budget, private archive/compaction, and timestamps; MSO never claims access to hidden ChatGPT transcript. Prefer bounded tools; use exec_job_start for long tests/builds. Never expose private chain-of-thought.`;
}

export async function dispatch(req: RpcRequest, scope: Scope, actor?: string, agentContext?: McpAgentContext): Promise<Record<string, unknown>> {
  const id = req.id ?? null;
  switch (req.method) {
    case "initialize":
    case "server/discover": {
      const tools = visibleTools(scope), toolset = toolsetInfo(tools, scope);
      return rpcOk(id, {
        protocolVersion: req.params?.protocolVersion ?? PROTOCOL,
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: { name: "mso", version: MCP_SERVER_VERSION }, instructions: instructions(scope),
        _meta: { toolset, ...(agentContext?.sessionId ? { agentSessionId: agentContext.sessionId } : {}) },
      });
    }
    case "notifications/initialized":
    case "ping": return rpcOk(id, {});
    case "tools/list": {
      const tools = visibleTools(scope);
      return rpcOk(id, { tools: toolList(scope), _meta: { toolset: toolsetInfo(tools, scope) } });
    }
    case "resources/list": return rpcOk(id, { resources: listUiResources() });
    case "resources/read": {
      const uri = String(req.params?.uri ?? "");
      if (!uri) return rpcFail(id, -32602, "resources/read needs { uri }");
      const resource = readUiResource(uri);
      if (!resource) return rpcFail(id, -32602, `unknown resource: ${uri}`);
      return rpcOk(id, { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.text, _meta: resource._meta }] });
    }
    case "tools/call": return dispatchToolCall(req, scope, actor, agentContext);
    default: return rpcFail(id, -32601, `unknown method: ${req.method}`);
  }
}

export const rpcError = rpcFail;
