import { TENANT_MEMORY_TOOLS } from "@/lib/tenancy/memory-tools";
import { executeCapabilityCall } from "@/lib/capabilities/execute";
import { allows, type Scope } from "@/lib/capabilities/scope";
import { tenantPrincipal } from "@/lib/tenancy/authority";
import { TOOLS_BY_NAME } from "./tools";
import { toolDescriptor, toolAllowedForProfile } from "./tool-contract";
import { MCP_PROTOCOL_LATEST, MCP_PROTOCOLS, negotiateMcpProtocol } from "./protocol";
import { MCP_SERVER_VERSION } from "./toolset";
import { rpcFail, rpcOk, type McpAgentContext, type RpcRequest } from "./dispatch-types";
import { structuredResult } from "./dispatch-tool-support";

const INSTRUCTIONS = "Tenant preview supports scoped memory read, search, remember and forget. Host, browser, app, project, session and provider operations are unavailable.";
export async function dispatchTenantRpc(req: RpcRequest, scope: Scope, actor: string, context: McpAgentContext): Promise<Record<string, unknown>> {
  const id = req.id ?? null;
  if (!context.tenantContext) return rpcFail(id, -32001, "tenant identity is required");
  try { await tenantPrincipal(context.tenantContext); }
  catch { return rpcFail(id, -32001, "tenant identity is unavailable"); }
  const modern = req.params?._meta?.["io.modelcontextprotocol/protocolVersion"] === MCP_PROTOCOL_LATEST;
  if (modern && ["initialize", "notifications/initialized"].includes(req.method ?? "")) {
    return rpcFail(id, -32601, "initialize is only supported in the legacy MCP era");
  }
  const profile = context.toolProfile ?? "full";
  const visible = TENANT_MEMORY_TOOLS.map(name => TOOLS_BY_NAME.get(name)).filter(tool => tool !== undefined)
    .filter(tool => allows(scope, tool.scope) && toolAllowedForProfile(tool.name, profile)
      && (!context.allowedTools || context.allowedTools.includes(tool.name)));
  switch (req.method) {
    case "server/discover":
      return modern ? rpcOk(id, { supportedVersions: [...MCP_PROTOCOLS], capabilities: { tools: {} },
        instructions: INSTRUCTIONS, cacheScope: "private", ttlMs: 0 }) : rpcFail(id, -32601, "modern metadata required");
    case "initialize":
      return rpcOk(id, { protocolVersion: negotiateMcpProtocol(req.params?.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "mso", version: MCP_SERVER_VERSION }, instructions: INSTRUCTIONS });
    case "ping":
    case "notifications/initialized": return rpcOk(id, {});
    case "tools/list": return rpcOk(id, { tools: visible.map(tool => toolDescriptor(tool, profile)), cacheScope: "private", ttlMs: 0 });
    case "resources/list": return rpcOk(id, { resources: [] });
    case "resources/templates/list": return rpcOk(id, { resourceTemplates: [] });
    case "prompts/list": return rpcOk(id, { prompts: [] });
    case "tools/call": {
      const tool = visible.find(candidate => candidate.name === req.params?.name);
      if (!tool) return rpcFail(id, -32602, "tool unavailable in tenant preview");
      const args = req.params?.arguments ?? {};
      const outcome = await executeCapabilityCall({ tool, args, scope, actor, context });
      if (outcome.kind === "protocol_error") return rpcFail(id, outcome.code, outcome.message);
      if (outcome.kind === "error") return rpcOk(id, { content: [{ type: "text", text: outcome.message }], isError: true });
      return rpcOk(id, structuredResult(tool.name, outcome.result, profile));
    }
    default: return rpcFail(id, -32601, "method unavailable in tenant preview");
  }
}
