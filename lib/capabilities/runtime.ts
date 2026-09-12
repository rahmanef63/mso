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
  name: string;
  args?: Record<string, unknown>;
  scope: Scope;
  actor?: string;
  principal?: string;
  sessionId?: string;
}

export interface CapabilityInvocationResult {
  content: CapabilityContent[];
  isError?: boolean;
}

export interface CapabilityRuntime {
  list(scope: Scope): CapabilityDescriptor[];
  invoke(input: CapabilityInvocation): Promise<CapabilityInvocationResult>;
}
