import type { TenantContext } from "@/lib/tenancy/authority";
import type { CapabilityToolProfile } from "./tool";

export interface CapabilityAgentContext { tenantContext?: TenantContext; principal?: string; sessionId?: string; workflowActorOverride?: string; toolProfile?: CapabilityToolProfile; trustedOpenAiFileParams?: boolean; allowedTools?: readonly string[]; toolArgumentConstraints?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>; }
export function workflowActor(actor: string | undefined, context?: CapabilityAgentContext): string | undefined {
  if (context?.workflowActorOverride) return context.workflowActorOverride;
  return context?.principal && context.sessionId ? `${context.principal}#session:${context.sessionId}` : actor;
}
export function recipeActor(actor: string | undefined, context?: CapabilityAgentContext): string | undefined {
  return context?.principal ?? actor;
}
