import { appendAgentSessionEvent } from "@/lib/agent/session-store";
import type { ActiveWorkflow } from "@/lib/skills/memory";
import { isMcpDirectResult } from "./tool-kit";
import { boundedResultText } from "./result-budget";
import { TOOLS_BY_NAME } from "./tools";
import type { McpAgentContext } from "./dispatch-types";
import type { McpToolProfile } from "./tool-contract";

export function sessionDetail(name: string, args: Record<string, unknown>, target?: string): string | undefined {
  if (name === "workflow_start") {
    const intent = typeof args.intent === "string" ? args.intent.slice(0, 320) : "";
    const project = typeof args.project === "string" ? args.project.slice(0, 120) : "";
    return [intent, project ? `project=${project}` : ""].filter(Boolean).join(" · ") || undefined;
  }
  if (name === "workflow_finish") return typeof args.summary === "string" ? args.summary.slice(0, 400) : target;
  if (name === "workflow_cancel") return typeof args.reason === "string" ? args.reason.slice(0, 300) : target;
  return target || undefined;
}

export async function recordAgentEvent(
  context: McpAgentContext | undefined,
  tool: string,
  state: string,
  args: Record<string, unknown>,
  workflowId?: string,
  target?: string,
): Promise<void> {
  if (!context?.principal || !context.sessionId) return;
  await appendAgentSessionEvent(context.principal, context.sessionId, {
    kind: tool.startsWith("workflow_") ? "workflow" : "tool",
    tool, state, workflowId, detail: sessionDetail(tool, args, target),
  }).catch(() => undefined);
}

export function flowFields(workflow: ActiveWorkflow | null | undefined) {
  return workflow ? { workflowId: workflow.id, workflowIntent: workflow.intent, workflowProject: workflow.project } : {};
}

export function workflowFromResult(result: unknown): ActiveWorkflow | null {
  if (!result || typeof result !== "object") return null;
  const workflow = (result as { workflow?: unknown }).workflow;
  if (!workflow || typeof workflow !== "object") return null;
  const row = workflow as Partial<ActiveWorkflow>;
  return typeof row.id === "string" && typeof row.intent === "string" ? row as ActiveWorkflow : null;
}

function boundedStructuredValue(result: unknown, policy?: { maxTextBytes?: number; overflowHint?: string }): unknown {
  const text = boundedResultText(result, policy);
  try { return JSON.parse(text); } catch { return text; }
}

export function structuredResult(toolName: string, result: unknown, profile: McpToolProfile = "full") {
  const tool = TOOLS_BY_NAME.get(toolName);
  if (isMcpDirectResult(result)) {
    return {
      content: result.content,
      ...(profile === "chatgpt" && result.structuredContent ? { structuredContent: result.structuredContent } : {}),
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
      // Do not duplicate the full JSON in ChatGPT's transcript: the structured
      // result already contains it. Generic MCP clients keep the old text-only form.
      content: [{ type: "text" as const, text: `Structured result returned by ${toolName}.` }],
    };
  }
  return { content: [{ type: "text" as const, text }] };
}
