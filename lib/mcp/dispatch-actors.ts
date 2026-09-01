import type { McpAgentContext } from "./dispatch-types";

/** Active workflow/job ownership is conversation-scoped when a durable session exists. */
export function workflowActor(actor: string | undefined, context?: McpAgentContext): string | undefined {
  return context?.principal && context.sessionId ? `${context.principal}#session:${context.sessionId}` : actor;
}

/** Verified recipes intentionally survive conversation boundaries for one stable client principal. */
export function recipeActor(actor: string | undefined, context?: McpAgentContext): string | undefined {
  return context?.principal ?? actor;
}
