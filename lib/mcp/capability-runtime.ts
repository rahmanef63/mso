import { authorizeDurableGrant } from "./durable-grant";
import { allows } from "@/lib/capabilities/scope";
import { executeCapabilityCall } from "@/lib/capabilities/execute";
import { boundedResultText } from "@/lib/capabilities/result-budget";
import { isCapabilityDirectResult } from "@/lib/capabilities/tool";
import type { CapabilityInvocationResult, CapabilityRuntime } from "@/lib/capabilities/runtime";
import { TOOLS, TOOLS_BY_NAME } from "./tools";
import { toolAllowedForProfile } from "./tool-contract";

function successResult(toolName: string, result: unknown): CapabilityInvocationResult {
  if (isCapabilityDirectResult(result))
    return { content: result.content, ...(result.isError ? { isError: true } : {}) };
  const tool = TOOLS_BY_NAME.get(toolName);
  return { content: [{ type: "text", text: boundedResultText(result, tool?.result) }] };
}

/** Concrete MSO catalog composed once; MCP/A2A/subagents are adapters over it. */
export const msoCapabilityRuntime: CapabilityRuntime = {
  authorize: authorizeDurableGrant,
  list(scope, context) {
    return TOOLS.filter((tool) => allows(scope, tool.scope) && (!context?.allowedTools || context.allowedTools.includes(tool.name)) && toolAllowedForProfile(tool.name, context?.toolProfile ?? "full")).map((tool) => ({
      name: tool.name,
      description: tool.description,
      scope: tool.scope,
      inputSchema: tool.inputSchema,
    }));
  },
  async invoke(input) {
    if (input.authorizationGrant && (!input.principal || !await authorizeDurableGrant(input.authorizationGrant, input.principal, input.name, input.args))) return { content: [{ type: "text", text: "error: durable execution grant is revoked, expired or does not allow this tool" }], isError: true };
    const tool = TOOLS_BY_NAME.get(input.name);
    if (!tool) return { content: [{ type: "text", text: `error: unknown tool: ${input.name}` }], isError: true };
    const args = { ...(input.args ?? {}) };
    if (input.workflowId) args.workflow_id = input.workflowId;
    const outcome = await executeCapabilityCall({
      tool,
      args,
      scope: input.scope,
      actor: input.actor,
      context: {
        tenantContext: input.tenantContext,
        principal: input.principal,
        authorizationGrant: input.authorizationGrant,
        allowedTools: input.allowedTools,
        toolArgumentConstraints: input.toolArgumentConstraints,
        toolProfile: input.toolProfile,
        sessionId: input.sessionId,
        ...(input.workflowActor ? { workflowActorOverride: input.workflowActor } : {}),
        capabilities: msoCapabilityRuntime,
      },
    });
    if (outcome.kind === "protocol_error")
      return { content: [{ type: "text", text: `error: ${outcome.message}` }], isError: true };
    if (outcome.kind === "error") return { content: [{ type: "text", text: outcome.message }], isError: true };
    return successResult(input.name, outcome.result);
  },
};
