import type { AuthorizationGrant } from "@/lib/capabilities/authorization-grant";
import type { TenantContext } from "@/lib/tenancy/authority";
import type { Scope } from "./scope";

export type { McpContent as CapabilityContent } from "@/lib/contracts/mcp-content";
import type { McpContent as CapabilityContent } from "@/lib/contracts/mcp-content";

export interface CapabilityDescriptor {
  name: string;
  description: string;
  scope: Scope;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export interface CapabilityInvocation {
  allowedTools?: readonly string[];
  toolArgumentConstraints?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  toolProfile?: "full" | "chatgpt";
  tenantContext?: TenantContext;
  name: string;
  args?: Record<string, unknown>;
  scope: Scope;
  actor?: string;
  principal?: string;
  authorizationGrant?: AuthorizationGrant;
  sessionId?: string;
  /** Optional fixed workflow context used by durable delegated workers. */
  workflowId?: string;
  workflowActor?: string;
}

export interface CapabilityInvocationResult {
  content: CapabilityContent[];
  isError?: boolean;
}

export interface CapabilityRuntime {
  authorize?(grant: AuthorizationGrant, principal: string, name?: string, args?: Record<string, unknown>): Promise<boolean>;
  list(scope: Scope, context?: Pick<CapabilityInvocation, "allowedTools" | "toolProfile">): CapabilityDescriptor[];
  invoke(input: CapabilityInvocation): Promise<CapabilityInvocationResult>;
}
