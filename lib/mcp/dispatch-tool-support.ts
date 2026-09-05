import { capabilityPrivateMeta } from "@/lib/capabilities/tool";
export { sessionDetail, recordAgentEvent, flowFields, workflowFromResult } from "@/lib/capabilities/execution-support";
import { isMcpDirectResult } from "./tool-kit";
import { boundedResultText } from "./result-budget";
import { TOOLS_BY_NAME } from "./tools";
import type { McpToolProfile } from "./tool-contract";

function boundedStructuredValue(result: unknown, policy?: { maxTextBytes?: number; overflowHint?: string }): unknown {
  const text = boundedResultText(result, policy);
  try { return JSON.parse(text); } catch { return text; }
}

/** MCP/profile serialization only. Execution policy lives in lib/capabilities. */
export function structuredResult(toolName: string, result: unknown, profile: McpToolProfile = "full") {
  const tool = TOOLS_BY_NAME.get(toolName);
  if (isMcpDirectResult(result)) {
    return {
      content: result.content,
      ...(profile === "chatgpt" && capabilityPrivateMeta(result) ? { _meta: capabilityPrivateMeta(result) } : {}),
      ...((profile === "chatgpt" || tool?.outputSchema) && result.structuredContent ? { structuredContent: result.structuredContent } : {}),
      ...(result.isError ? { isError: true } : {}),
    };
  }

  const text = boundedResultText(result, tool?.result);
  if (tool?.outputSchema) {
    const structured = tool.toStructuredContent
      ? tool.toStructuredContent(result)
      : result !== null && typeof result === "object" && !Array.isArray(result)
        ? result as Record<string, unknown>
        : undefined;
    return structured ? { structuredContent: structured, content: [{ type: "text" as const, text }] } : { content: [{ type: "text" as const, text }] };
  }

  if (profile === "chatgpt") {
    return {
      structuredContent: { result: boundedStructuredValue(result, tool?.result) },
      // Avoid duplicating the same bounded JSON in the ChatGPT transcript.
      content: [{ type: "text" as const, text: `Structured result returned by ${toolName}.` }],
    };
  }
  return { content: [{ type: "text" as const, text }] };
}
