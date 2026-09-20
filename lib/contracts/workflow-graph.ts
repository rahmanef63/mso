import type { GraphCustomNode } from "./graph-custom-nodes";
export const WORKFLOW_GRAPH_NODE_TYPES = [
  "manual", "schedule", "webhook", "tool", "project_function", "project_mcp", "integration", "script", "agent", "subflow",
  "condition", "switch", "merge", "batch", "loop", "repeat", "wait", "cache", "memory", "session", "directory", "project", "folder", "skill", "knowledge", "output",
] as const;
export type WorkflowGraphNodeType = (typeof WORKFLOW_GRAPH_NODE_TYPES)[number];
export type WorkflowGraphStatus = "draft" | "active" | "archived";

export type WorkflowGraphNode = {
  id: string;
  name: string;
  type: WorkflowGraphNodeType;
  position: { x: number; y: number };
  config: Record<string, unknown>;
  disabled?: boolean;
};

export type WorkflowGraphEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  /** Optional visual override. Branch/error semantics may still color the edge. */
  style?: "solid" | "dashed";
  /** Disabled edges stay visible in the editor but are excluded from execution/topology. */
  disabled?: boolean;
};

export type WorkflowGraphMetadata = {
  customNodes?: GraphCustomNode[];
  intent?: string;
  normalizedIntent?: string;
  project?: string;
  provenance?: "user" | "learned-from-session" | "clone" | "import" | "template" | "ai-assisted";
  fingerprint?: string;
  sourceDigests?: string[];
  tags?: string[];
  folder?: string;
  errorWorkflowId?: string;
  timezone?: string;
};

export type WorkflowGraph = {
  version: 2;
  id: string;
  name: string;
  description: string;
  status: WorkflowGraphStatus;
  inputs: Record<string, unknown>;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  metadata: WorkflowGraphMetadata;
  createdAt: string;
  updatedAt: string;
  revision: string;
};

export type WorkflowGraphNodeState = "queued" | "running" | "completed" | "failed" | "skipped" | "blocked";
export type WorkflowGraphRunEdgeState = "pending" | "enabled" | "disabled";
export type WorkflowGraphRunEdge = {
  id: string; source: string; target: string; sourceHandle?: string; state: WorkflowGraphRunEdgeState;
};

export type WorkflowGraphRunNode = {
  id: string;
  name: string;
  type: WorkflowGraphNodeType;
  state: WorkflowGraphNodeState;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  logs: string[];
  attempts?: number;
  waitingUntil?: string;
};

export type WorkflowGraphRun = {
  version: 1;
  id: string;
  owner: string;
  sessionId: string;
  graphId: string;
  graphRevision: string;
  graphName: string;
  idempotencyKey: string;
  fingerprint: string;
  state: "running" | "completed" | "completed_with_errors" | "failed" | "interrupted";
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  failedNodeId?: string;
  failedNodeName?: string;
  error?: string;
  pid: number;
  instance: string;
  nodes: WorkflowGraphRunNode[];
  edges?: WorkflowGraphRunEdge[];
  trigger?: { type: "manual" | "schedule" | "webhook" | "system"; nodeId?: string; receivedAt: string };
  ancestry?: string[];
};
