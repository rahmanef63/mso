export const WORKFLOW_GRAPH_NODE_TYPES = [
  "manual", "tool", "project_function", "project_mcp", "script", "agent", "subflow",
  "condition", "project", "folder", "skill", "knowledge", "output",
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
};

export type WorkflowGraphMetadata = {
  intent?: string;
  normalizedIntent?: string;
  project?: string;
  provenance?: "user" | "learned-from-session" | "clone" | "import";
  fingerprint?: string;
  sourceDigests?: string[];
  tags?: string[];
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
  state: "running" | "completed" | "failed" | "interrupted";
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  failedNodeId?: string;
  failedNodeName?: string;
  error?: string;
  pid: number;
  instance: string;
  nodes: WorkflowGraphRunNode[];
};
