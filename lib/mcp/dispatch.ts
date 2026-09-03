import type { Scope } from "./scope";
import { MCP_SERVER_VERSION, toolsetInfo } from "./toolset";
import { TOOLS } from "./tools";
import { listUiResources, readUiResource } from "./ui-resources";
import { dispatchToolCall } from "./dispatch-tools";
import { toolDescriptor, visibleToolsForProfile, type McpToolProfile } from "./tool-contract";
import { negotiateMcpProtocol } from "./protocol";
import { rpcFail, rpcOk, type McpAgentContext, type RpcRequest } from "./dispatch-types";
export type { McpAgentContext, RpcRequest } from "./dispatch-types";

export const UNAUTHORIZED = -32001;
export const RATE_LIMITED = -32029;

export function isNotification(body: unknown): boolean {
  const b = body as RpcRequest | null;
  return b?.id == null && String(b?.method ?? "").startsWith("notifications/");
}

const visibleTools = (scope: Scope, profile: McpToolProfile = "full") => visibleToolsForProfile(TOOLS, scope, profile);
const toolList = (scope: Scope, profile: McpToolProfile = "full") => visibleTools(scope, profile).map((tool) => toolDescriptor(tool, profile));

function instructions(scope: Scope, profile: McpToolProfile = "full"): string {
  const startup = scope === "read"
    ? "This token is read-only: use skills_search for capability discovery, then bounded read tools."
    : "For multi-step work call workflow_start once, pass its exact workflow_id on every operation in this conversation, verify, then workflow_finish or workflow_cancel.";
  const projectBoundary = profile === "chatgpt" ? " Project-owned MCP tools never join this catalog: use project_mcp_tools then project_mcp_call." : "";
  return `${startup}${projectBoundary} Session/workflow state is isolated per conversation. Prefer bounded tools and exec_job_start for long builds. Never expose hidden transcripts, credentials, or private chain-of-thought.`;
}

export async function dispatch(req: RpcRequest, scope: Scope, actor?: string, agentContext?: McpAgentContext): Promise<Record<string, unknown>> {
  const id = req.id ?? null;
  switch (req.method) {
    case "initialize": {
      const profile = agentContext?.toolProfile ?? "full";
      const tools = visibleTools(scope, profile), toolset = toolsetInfo(tools, scope, profile);
      return rpcOk(id, {
        protocolVersion: negotiateMcpProtocol(req.params?.protocolVersion),
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: { name: "mso", version: MCP_SERVER_VERSION }, instructions: instructions(scope, profile),
        _meta: { toolset, ...(agentContext?.sessionId ? { agentSessionId: agentContext.sessionId } : {}) },
      });
    }
    case "notifications/initialized":
    case "ping": return rpcOk(id, {});
    case "tools/list": {
      const profile = agentContext?.toolProfile ?? "full";
      const tools = visibleTools(scope, profile);
      return rpcOk(id, { tools: toolList(scope, profile), _meta: { toolset: toolsetInfo(tools, scope, profile) } });
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
