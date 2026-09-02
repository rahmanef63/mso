import type { CapabilityToolProfile } from "./tool";

export interface CapabilityAgentContext { principal?: string; sessionId?: string; toolProfile?: CapabilityToolProfile; }
export function workflowActor(actor: string | undefined, context?: CapabilityAgentContext): string | undefined {
  return context?.principal && context.sessionId ? `${context.principal}#session:${context.sessionId}` : actor;
}
export function recipeActor(actor: string | undefined, context?: CapabilityAgentContext): string | undefined {
  return context?.principal ?? actor;
}
