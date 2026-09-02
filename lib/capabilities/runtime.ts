import type { Scope } from "./scope";

export type CapabilityContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

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
