import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";

export const SESSION_PAGE_SIZE = 6;
export const SESSION_EVENT_PAGE_SIZE = 20;
export const SESSION_GRAPH_EVENT_LIMIT = 120;
export type SessionStatus = "ready" | "idle" | "busy" | "ended" | "offline";
export interface SessionCard {
  id: string;
  name: string;
  label: string;
  title: string;
  source: "mcp" | "cli" | "alfa";
  status: SessionStatus;
  receiverConnected: boolean;
  lastSeenAt: string;
  createdAt: string;
  cwd?: string;
  eventCount: number;
  archiveCount: number;
  resumedFrom?: string;
  parentSessionId?: string;
}
export interface SessionLog {
  at: string;
  kind: string;
  tool?: string;
  state?: string;
  detail?: string;
  workflowId?: string;
}
export interface SessionPage {
  sessions: SessionCard[];
  total: number;
  activeCount: number;
  page: number;
  pages: number;
  pageSize: number;
  observedAt: string;
}
export interface SessionDetail {
  session: SessionCard;
  events: SessionLog[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  observedAt: string;
}

export type SessionFlowCategory = "context" | "plan" | "inspect" | "implement" | "verify" | "integrate" | "deploy" | "result" | "other";
export interface SessionFlowArtifact {
  ref: string;
  revisionRef: string;
  path: string;
  relativePath: string;
  label: string;
  kind: "file" | "script";
  language?: string;
}
export interface SessionFlowAction {
  /** Opaque durable identity scoped to the session. Not rendered as the human reference. */
  id: string;
  ref: string;
  eventRef: string;
  title: string;
  category: SessionFlowCategory;
  at: string;
  kind: string;
  tool?: string;
  state?: string;
  detail?: string;
  terminalContext?: boolean;
  code?: { kind: "command" | "script" | "snippet"; language: string; content: string };
  artifact?: SessionFlowArtifact;
}
export interface SessionFlowActionGroup {
  ref: string;
  key: string;
  title: string;
  actionRefs: string[];
  count: number;
}
export interface SessionFlowStep {
  /** Opaque durable identity scoped to the session. */
  id: string;
  ref: string;
  title: string;
  category: SessionFlowCategory;
  summary: string;
  startedAt: string;
  finishedAt: string;
  groups: SessionFlowActionGroup[];
  actions: SessionFlowAction[];
}
export interface SessionFlowActionResolution {
  step: SessionFlowStep;
  action: SessionFlowAction;
  beforeRef?: string;
  afterRef?: string;
}

export interface SessionGraphView {
  session: SessionCard;
  graph: WorkflowGraph;
  steps: SessionFlowStep[];
  totalEvents: number;
  shownEvents: number;
  omittedEvents: number;
  observedAt: string;
}
