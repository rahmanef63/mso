import type { Scope } from "./scope";
import { MCP_SERVER_VERSION, toolsetInfo } from "./toolset";
import { TOOLS } from "./tools";
import { MCP_APP_MIME_TYPE, MCP_UI_EXTENSION, MCP_UI_EXTENSION_CAPABILITY, listUiResources, readUiResource } from "./ui-resources";
import { MCP_SKILLS_EXTENSION, getMcpSkill, listMcpSkills, readMcpSkillResource } from "./skills-extension";
import { dispatchToolCall } from "./dispatch-tools";
import { readMcpFileResource } from "./file-transfer-resource";
import { toolDescriptor, visibleToolsForProfile, type McpToolProfile } from "./tool-contract";
import { MCP_PROTOCOL_LATEST, MCP_PROTOCOLS, negotiateMcpProtocol } from "./protocol";
import { mcpInstructions } from "./instructions";
import { rpcFail, rpcOk, type McpAgentContext, type RpcRequest } from "./dispatch-types";
import { newActivityId, recordMcpActivity } from "./activity";
export type { McpAgentContext, RpcRequest } from "./dispatch-types";

export const UNAUTHORIZED = -32001;
export const RATE_LIMITED = -32029;

export function isNotification(body: unknown): boolean {
  const b = body as RpcRequest | null;
  return b?.id == null && String(b?.method ?? "").startsWith("notifications/");
}

const toolAllowed = (name: string, allowedTools?: readonly string[]) => !allowedTools || allowedTools.includes(name);
const visibleTools = (scope: Scope, profile: McpToolProfile = "full", allowedTools?: readonly string[]) =>
  visibleToolsForProfile(TOOLS, scope, profile).filter((tool) => toolAllowed(tool.name, allowedTools));
const toolList = (scope: Scope, profile: McpToolProfile = "full", allowedTools?: readonly string[]) =>
  visibleTools(scope, profile, allowedTools).map((tool) => toolDescriptor(tool, profile));

const instructions = mcpInstructions;

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const serverExtensions = {
  [MCP_SKILLS_EXTENSION]: {},
  [MCP_UI_EXTENSION]: MCP_UI_EXTENSION_CAPABILITY,
} as const;
function clientSupportsUi(req: RpcRequest, modern: boolean): boolean {
  const meta = object(req.params?._meta) ? req.params?._meta : undefined;
  const capabilities = modern
    ? (object(meta?.["io.modelcontextprotocol/clientCapabilities"]) ? meta?.["io.modelcontextprotocol/clientCapabilities"] : undefined)
    : req.params?.capabilities;
  if (!object(capabilities) || !object(capabilities.extensions)) return false;
  const ui = capabilities.extensions[MCP_UI_EXTENSION];
  return object(ui) && Array.isArray(ui.mimeTypes) && ui.mimeTypes.includes(MCP_APP_MIME_TYPE);
}
function activityStart(tool: string, scope: Scope, actor: string | undefined, target?: string) {
  const id = newActivityId(), startedAt = Date.now();
  void recordMcpActivity({ id, tool, state: "started", actor, scope, target });
  return { id, startedAt };
}
function activityFinish(
  activity: { id: string; startedAt: number },
  tool: string,
  scope: Scope,
  actor: string | undefined,
  state: "completed" | "failed" | "invalid_args",
  target?: string,
  detail?: string,
) {
  void recordMcpActivity({
    id: activity.id, tool, state, actor, scope, target,
    durationMs: Date.now() - activity.startedAt, detail,
  });
}


export async function dispatch(req: RpcRequest, scope: Scope, actor?: string, agentContext?: McpAgentContext): Promise<Record<string, unknown>> {
  const id = req.id ?? null;
  const modern = req.params?._meta?.["io.modelcontextprotocol/protocolVersion"] === MCP_PROTOCOL_LATEST;
  if (modern && (req.method === "initialize" || req.method === "notifications/initialized")) return rpcFail(id, -32601, "initialize is only supported in the legacy MCP era");
  switch (req.method) {
    case "server/discover": {
      if (!modern) return rpcFail(id, -32601, "server/discover requires modern per-request metadata");
      const activity = activityStart("protocol.discover", scope, actor);
      const ui = clientSupportsUi(req, true);
      activityFinish(activity, "protocol.discover", scope, actor, "completed", undefined, "client-ui=" + ui + ";server-ui=true");
      return rpcOk(id, { resultType: "complete", supportedVersions: [...MCP_PROTOCOLS],
        capabilities: { tools: {}, resources: {}, extensions: serverExtensions },
        _meta: { "io.modelcontextprotocol/serverInfo": { name: "mso", version: MCP_SERVER_VERSION } },
        instructions: instructions(scope, agentContext?.toolProfile, agentContext?.allowedTools), ttlMs: 30_000, cacheScope: "private" });
    }

    case "initialize": {
      const profile = agentContext?.toolProfile ?? "full";
      const allowedTools = agentContext?.allowedTools;
      const tools = visibleTools(scope, profile, allowedTools), toolset = toolsetInfo(tools, scope, profile);
      const activity = activityStart("protocol.initialize", scope, actor);
      const ui = clientSupportsUi(req, false);
      activityFinish(activity, "protocol.initialize", scope, actor, "completed", undefined, "client-ui=" + ui + ";server-ui=true");
      return rpcOk(id, {
        protocolVersion: negotiateMcpProtocol(req.params?.protocolVersion),
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, extensions: serverExtensions },
        serverInfo: { name: "mso", version: MCP_SERVER_VERSION }, instructions: instructions(scope, profile, allowedTools),
        _meta: { toolset, ...(agentContext?.sessionId ? { agentSessionId: agentContext.sessionId } : {}) },
      });
    }
    case "notifications/initialized":
    case "ping": return rpcOk(id, {});
    case "tools/list": {
      const profile = agentContext?.toolProfile ?? "full";
      const allowedTools = agentContext?.allowedTools;
      const tools = visibleTools(scope, profile, allowedTools);
      return rpcOk(id, { tools: toolList(scope, profile, allowedTools), _meta: { toolset: toolsetInfo(tools, scope, profile) } });
    }
    case "resources/list": {
      const activity = activityStart("resources.list", scope, actor);
      const resources = await listUiResources();
      activityFinish(activity, "resources.list", scope, actor, "completed", undefined, "count=" + resources.length);
      return rpcOk(id, { resources });
    }
    case "resources/read": {
      const uri = String(req.params?.uri ?? "");
      const activity = activityStart("resources.read", scope, actor, uri || undefined);
      if (!uri) {
        activityFinish(activity, "resources.read", scope, actor, "invalid_args", undefined, "missing uri");
        return rpcFail(id, -32602, "resources/read needs { uri }");
      }
      const resource = await readUiResource(uri);
      if (resource) {
        activityFinish(activity, "resources.read", scope, actor, "completed", uri, "ui mime=" + resource.mimeType);
        return rpcOk(id, { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.text, _meta: resource._meta }] });
      }
      try {
        const fileResource = await readMcpFileResource(uri, agentContext?.principal, agentContext?.sessionId);
        if (fileResource) {
          activityFinish(activity, "resources.read", scope, actor, "completed", uri, "file mime=" + fileResource.mimeType);
          return rpcOk(id, { contents: [{ uri: fileResource.uri, mimeType: fileResource.mimeType, blob: fileResource.data.toString("base64") }] });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        activityFinish(activity, "resources.read", scope, actor, "failed", uri, message);
        return rpcFail(id, -32602, message);
      }
      try {
        const skillResource = await readMcpSkillResource(uri);
        if (skillResource) {
          activityFinish(activity, "resources.read", scope, actor, "completed", uri, "skill mime=" + skillResource.mimeType);
          return rpcOk(id, { contents: [skillResource] });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        activityFinish(activity, "resources.read", scope, actor, "failed", uri, message);
        return rpcFail(id, -32602, message);
      }
      activityFinish(activity, "resources.read", scope, actor, "failed", uri, "unknown resource");
      return rpcFail(id, -32602, "unknown resource: " + uri);
    }
    case "skills/list": {
      try { return rpcOk(id, await listMcpSkills(typeof req.params?.cursor === "string" ? req.params.cursor : undefined)); }
      catch (error) { return rpcFail(id, -32602, error instanceof Error ? error.message : String(error)); }
    }
    case "skills/get": {
      const uri = String(req.params?.uri ?? "");
      if (!uri) return rpcFail(id, -32602, "skills/get needs { uri }");
      try { return rpcOk(id, await getMcpSkill(uri)); }
      catch (error) { return rpcFail(id, -32602, error instanceof Error ? error.message : String(error)); }
    }
    case "tools/call": return dispatchToolCall(req, scope, actor, agentContext);
    default: return rpcFail(id, -32601, `unknown method: ${req.method}`);
  }
}

export const rpcError = rpcFail;
