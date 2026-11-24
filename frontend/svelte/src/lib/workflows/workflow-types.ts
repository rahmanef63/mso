import type {
  WorkflowGraphStatus,
  WorkflowRunState,
  WorkflowRunTriggerType,
} from "./workflows-api.ts";

export const WORKFLOW_NODE_TYPES = [
  "manual", "schedule", "webhook", "channel_trigger",
  "tool", "project_function", "project_mcp", "integration", "channel_send", "script",
  "agent", "subflow",
  "condition", "switch", "merge", "batch", "loop", "repeat", "wait",
  "cache", "data_table", "memory", "session", "directory", "project", "folder", "skill", "knowledge",
  "output",
] as const;

export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export type WorkflowNodeCategory = "Triggers" | "Actions" | "AI" | "Flow" | "Context";

export type WorkflowNode = {
  id: string;
  name: string;
  type: WorkflowNodeType;
  position: { x: number; y: number };
  config: Record<string, unknown>;
  disabled?: boolean;
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  style?: "solid" | "dashed";
  disabled?: boolean;
};

export type WorkflowMetadata = {
  tags?: string[];
  folder?: string;
  project?: string;
  timezone?: string;
  errorWorkflowId?: string;
  provenance?: "user" | "learned-from-session" | "clone" | "import" | "template" | "ai-assisted";
};

export type WorkflowGraphDetail = {
  version: 2;
  id: string;
  name: string;
  description: string;
  status: WorkflowGraphStatus;
  inputs: Record<string, unknown>;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  metadata: WorkflowMetadata;
  createdAt: string;
  updatedAt: string;
  revision: string;
};

export type WorkflowGraphDraft = {
  id?: string;
  name: string;
  description: string;
  status: WorkflowGraphStatus;
  inputs: Record<string, unknown>;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  metadata: WorkflowMetadata;
};

export type WorkflowRunNodeState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "blocked";

export type WorkflowRunNodeDetail = {
  id: string;
  name: string;
  type: string;
  state: WorkflowRunNodeState;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  logs: string[];
  attempts?: number;
};

export type WorkflowRunDetail = {
  id: string;
  graphId: string;
  graphRevision: string;
  graphName: string;
  state: WorkflowRunState;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  failedNodeId: string | null;
  failedNodeName: string | null;
  error: string | null;
  triggerType: WorkflowRunTriggerType | null;
  nodes: WorkflowRunNodeDetail[];
};

export type NodeConfigFieldKind = "text" | "textarea" | "number" | "select" | "checkbox";

export type NodeConfigFieldSpec = {
  key: string;
  label: string;
  kind: NodeConfigFieldKind;
  placeholder?: string;
  options?: string[];
};

export type WorkflowPaletteItem = {
  id: string;
  type: WorkflowNodeType;
  title: string;
  category: WorkflowNodeCategory;
  badge: string;
  description: string;
  defaultName: string;
  defaults: Record<string, unknown>;
};

export type WorkflowStarterTemplate = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  tags: string[];
  build: () => WorkflowGraphDraft;
};

const TRIGGER_TYPES = new Set<WorkflowNodeType>([
  "manual", "schedule", "webhook", "channel_trigger",
]);

const AI_TYPES = new Set<WorkflowNodeType>(["agent"]);

const FLOW_TYPES = new Set<WorkflowNodeType>([
  "condition", "switch", "merge", "batch", "loop", "repeat", "wait", "subflow", "output",
]);

const CONTEXT_TYPES = new Set<WorkflowNodeType>([
  "cache", "data_table", "memory", "session", "directory", "project", "folder", "skill", "knowledge",
]);

export function isTriggerNodeType(type: WorkflowNodeType): boolean {
  return TRIGGER_TYPES.has(type);
}

export function nodeCategoryOf(type: WorkflowNodeType): WorkflowNodeCategory {
  if (TRIGGER_TYPES.has(type)) return "Triggers";
  if (AI_TYPES.has(type)) return "AI";
  if (FLOW_TYPES.has(type)) return "Flow";
  if (CONTEXT_TYPES.has(type)) return "Context";
  return "Actions";
}

export function nodeBadgeOf(node: Pick<WorkflowNode, "type" | "config">): string {
  const kind = typeof node.config.kind === "string" ? node.config.kind : "";
  if (node.type === "webhook") return "Webhook";
  if (node.type === "schedule") return "Cron";
  if (node.type === "manual") return "Manual";
  if (node.type === "channel_trigger") return "Channel";
  if (node.type === "integration" || kind === "http") return "HTTP";
  if (node.type === "tool" || node.type === "script") return kind === "host" ? "Host" : "Action";
  if (node.type === "agent") return "AI Agent";
  if (node.type === "condition" || node.type === "switch") return "Branch";
  if (node.type === "merge") return "Transform";
  if (node.type === "wait") return "Delay";
  if (node.type === "channel_send") return "Notify";
  if (node.type === "output") return "Output";
  return nodeCategoryOf(node.type);
}

export function sourceHandlesOf(node: Pick<WorkflowNode, "type">): string[] {
  if (node.type === "condition") return ["true", "false"];
  if (node.type === "repeat") return ["done", "exhausted"];
  if (node.type === "output") return [];
  return ["out"];
}
