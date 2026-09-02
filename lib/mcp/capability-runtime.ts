import { allows } from "@/lib/capabilities/scope";
import { executeCapabilityCall } from "@/lib/capabilities/execute";
import { boundedResultText } from "@/lib/capabilities/result-budget";
import { isCapabilityDirectResult } from "@/lib/capabilities/tool";
import type { CapabilityInvocationResult, CapabilityRuntime } from "@/lib/capabilities/runtime";
import { TOOLS, TOOLS_BY_NAME } from "./tools";

function successResult(toolName: string, result: unknown): CapabilityInvocationResult {
  if (isCapabilityDirectResult(result))
    return { content: result.content, ...(result.isError ? { isError: true } : {}) };
  const tool = TOOLS_BY_NAME.get(toolName);
  return { content: [{ type: "text", text: boundedResultText(result, tool?.result) }] };
}

/** Concrete MSO catalog composed once; MCP/A2A/subagents are adapters over it. */
export const msoCapabilityRuntime: CapabilityRuntime = {
  list(scope) {
    return TOOLS.filter((tool) => allows(scope, tool.scope)).map((tool) => ({
      name: tool.name,
      description: tool.description,
      scope: tool.scope,
      inputSchema: tool.inputSchema,
    }));
  },
  async invoke(input) {
    const tool = TOOLS_BY_NAME.get(input.name);
    if (!tool) return { content: [{ type: "text", text: `error: unknown tool: ${input.name}` }], isError: true };
    const outcome = await executeCapabilityCall({
      tool,
      args: input.args ?? {},
      scope: input.scope,
      actor: input.actor,
      context: {
        principal: input.principal,
        sessionId: input.sessionId,
        capabilities: msoCapabilityRuntime,
      },
    });
    if (outcome.kind === "protocol_error")
      return { content: [{ type: "text", text: `error: ${outcome.message}` }], isError: true };
    if (outcome.kind === "error") return { content: [{ type: "text", text: outcome.message }], isError: true };
    return successResult(input.name, outcome.result);
  },
};
