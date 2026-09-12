export type FlowInput = {
  type: "string" | "number" | "integer" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: Array<string | number | boolean>;
};
export type FlowStep = {
  id: string;
  tool: "integration_execute" | "project_mcp_call" | "project_function_call";
  arguments: Record<string, unknown>;
  expect?: { path: string; equals: unknown };
};
export type AutomationFlow = {
  id: string;
  description: string;
  inputs: Record<string, FlowInput>;
  steps: FlowStep[];
};
export type FlowRun = {
  version: 1; id: string; owner: string; sessionId: string; project: string; flow: string;
  fingerprint: string; pid: number; instance: string;
  state: "running" | "completed" | "failed" | "interrupted";
  startedAt: string; updatedAt: string; finishedAt?: string;
  steps: Array<{ id: string; tool: string; state: "running" | "completed" | "failed"; durationMs?: number; result?: unknown; error?: string }>;
  error?: string;
};
