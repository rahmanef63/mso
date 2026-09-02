import { executeCapabilityCall } from "@/lib/capabilities/execute";
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
  if (!tool || !toolAllowedForProfile(name, profile)) return rpcFail(id, -32602, `unknown tool: ${name}`);
  const outcome = await executeCapabilityCall({ tool, args, scope, actor, context });
  if (outcome.kind === "protocol_error") return rpcFail(id, outcome.code, outcome.message);
  if (outcome.kind === "error") return rpcOk(id, { content: [{ type: "text", text: outcome.message }], isError: true });
  return rpcOk(id, structuredResult(name, outcome.result, profile));
}
