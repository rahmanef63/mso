import type { AgentMemorySnapshot } from "./memory-store";

export type AgentSessionSource = "cli" | "mcp" | "alfa";

export interface AgentSessionEvent {
  at: string;
  kind: "created" | "resumed" | "tool" | "workflow" | "note";
  tool?: string;
  state?: string;
  workflowId?: string;
  detail?: string;
}

export interface AgentSession {
  id: string;
  principalHash: string;
  source: AgentSessionSource;
  title: string;
  createdAt: string;
  updatedAt: string;
  resumedFrom?: string;
  memorySnapshot: AgentMemorySnapshot;
  history: unknown[];
  events: AgentSessionEvent[];
}

export interface AgentSessionSummary {
  id: string;
  source: AgentSessionSource;
  title: string;
  createdAt: string;
  updatedAt: string;
  resumedFrom?: string;
  eventCount: number;
  historyTurns: number;
}

export interface AgentSessionResumePacket {
  session: AgentSessionSummary;
  memorySnapshot: AgentMemorySnapshot;
  recentEvents: AgentSessionEvent[];
}
