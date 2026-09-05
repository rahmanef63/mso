import { executeCapabilityCall } from "@/lib/capabilities/execute";
import { audit } from "@/lib/host/audit-api";
import type { Scope } from "./scope";
import { TOOLS_BY_NAME } from "./tools";
import { toolAllowedForProfile } from "./tool-contract";
import { rpcFail, rpcOk, type McpAgentContext, type RpcRequest } from "./dispatch-types";
import { structuredResult } from "./dispatch-tool-support";

export async function dispatchToolCall(req: RpcRequest, scope: Scope, actor?: string, context?: McpAgentContext) {
  const id = req.id ?? null;
  const name = String(req.params?.name ?? ""), args = req.params?.arguments ?? {};
  const tool = TOOLS_BY_NAME.get(name);
  const profile = context?.toolProfile ?? "full";
  const allowedTools = context?.allowedTools;
  if (!tool || !toolAllowedForProfile(name, profile) || (allowedTools && !allowedTools.includes(name))) {
    if (tool && allowedTools && !allowedTools.includes(name)) void audit({ action: "mcp.denied", actor, target: name, ok: false, detail: "token tool allowlist" });
    return rpcFail(id, -32602, `unknown tool: ${name}`);
  }
  const constraints = context?.toolArgumentConstraints?.[name];
  if (constraints) {
    const denied = Object.entries(constraints).find(([key, allowed]) => typeof args[key] !== "string" || !allowed.includes(args[key] as string));
    if (denied) {
      void audit({ action: "mcp.denied", actor, target: name, ok: false, detail: `token argument constraint: ${denied[0]}` });
      return rpcFail(id, -32602, `tool input is not allowed for this token: ${denied[0]}`);
    }
  }
  const outcome = await executeCapabilityCall({ tool, args, scope, actor, context });
  if (outcome.kind === "protocol_error") return rpcFail(id, outcome.code, outcome.message);
  if (outcome.kind === "error") return rpcOk(id, { content: [{ type: "text", text: outcome.message }], isError: true });
  return rpcOk(id, structuredResult(name, outcome.result, profile));
}
