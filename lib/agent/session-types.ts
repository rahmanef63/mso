import type { artifactLocation } from "./artifact-paths";
import type { AgentMemorySnapshot } from "./memory-store";

export type AgentSessionSource = "cli" | "mcp" | "alfa";
export type AgentSessionTitleSource = "default" | "auto" | "manual";

export interface AgentSessionEvent {
  at: string;
  kind:
    | "created"
    | "resumed"
    | "tool"
    | "workflow"
    | "note"
    | "compacted"
    | "archived";
  tool?: string;
  state?: string;
  workflowId?: string;
  detail?: string;
}

export interface AgentSession {
  id: string;
  principalHash: string;
  source: AgentSessionSource;
  name: string;
  title: string;
  titleSource: AgentSessionTitleSource;
  conversationHash?: string;
  createdAt: string;
  updatedAt: string;
  resumedFrom?: string;
  cwd?: string;
  parentSessionId?: string;
  memorySnapshot: AgentMemorySnapshot;
  contextSummary?: string;
  history: unknown[];
  events: AgentSessionEvent[];
  estimatedTokens: number;
  lifetimeEstimatedTokens: number;
  compactThresholdTokens: number;
  compactionCount: number;
  archiveCount: number;
  lastCompactedAt?: string;
  lastArchivedAt?: string;
}

export interface AgentSessionSummary {
  artifacts?: ReturnType<typeof artifactLocation>;
  id: string;
  source: AgentSessionSource;
  name: string;
  title: string;
  titleSource: AgentSessionTitleSource;
  createdAt: string;
  updatedAt: string;
  resumedFrom?: string;
  cwd?: string;
  parentSessionId?: string;
  estimatedTokens: number;
  lifetimeEstimatedTokens: number;
  compactThresholdTokens: number;
  compactionCount: number;
  archiveCount: number;
  lastCompactedAt?: string;
  lastArchivedAt?: string;
  eventCount: number;
  historyTurns: number;
}

export interface AgentSessionResumePacket {
  session: AgentSessionSummary;
  memorySnapshot: AgentMemorySnapshot;
  contextSummary?: string;
  recentHistory: unknown[];
  recentEvents: AgentSessionEvent[];
}
