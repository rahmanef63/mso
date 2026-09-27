import type { artifactLocation } from "./artifact-paths";
import type { AgentMemorySnapshot } from "./memory-store";
import type { SessionFlowCategory } from "@/lib/contracts/session-monitor";

export type AgentSessionSource = "cli" | "mcp" | "alfa";
export type AgentSessionTitleSource = "default" | "auto" | "manual";

export interface AgentSessionEventSemantic {
  version: 1;
  step: number;
  action: number;
  category: SessionFlowCategory;
}

export interface AgentSessionArtifactRevision {
  version: 1;
  /** Capture-time cwd. Backend metadata used to resolve the project safely later. */
  cwd: string;
  /** Path relative to the capture-time cwd. */
  relativePath: string;
  repoRoot?: string;
  repoRelativePath?: string;
  gitHead?: string;
  headBlob?: string;
  worktreeBlob?: string;
  worktreeSha256?: string;
  bytes?: number;
  /** True only when the working file matched HEAD at capture time. */
  cleanAtCapture?: boolean;
}

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
  /** Durable semantic index metadata. Raw execution fields above remain the source of truth. */
  semantic?: AgentSessionEventSemantic;
  /** Compact proof metadata for future exact artifact history. Never stores the source body. */
  artifactRevision?: AgentSessionArtifactRevision;
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
  /** Count of events dropped before the first retained event. Legacy sessions normalize to zero. */
  eventSeqBase?: number;
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
  label: string;
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

export interface AgentSessionValueCapsule {
  kind: "mso.jev-session-capsule.v1";
  model: string;
  sourceSha256: string;
  sourceBytes: number;
  capturedAt: string;
  sessionLabel: string;
  updatedAt: string;
  decision: { id: string; version: number; threshold: number; provider: "jev" | "fallback"; model?: string; latencyMs?: number; inputTokens?: number; actualCostUsd?: number };
  summary: { candidateCount: number; acceptedCount: number; rejectedCount: number; semanticStepCount: number; toolCount: number; artifactRefCount: number };
  semanticSteps: Array<{ ref: string; category: SessionFlowCategory; title: string; summary: string; tools: string[]; actionRefs: string[]; artifactRefs: string[] }>;
  recommendations: Array<{ id: string; title: string; probability: number; actionRefs: string[]; guidance: string }>;
  continuation: { kind: "mso.jev-session-optimization.v1"; instruction: string; facts: string[]; recommendations: Array<{ id: string; probability: number; actionRefs: string[]; guidance: string }> };
}

export interface AgentSessionResumePacket {
  session: AgentSessionSummary;
  memorySnapshot: AgentMemorySnapshot;
  contextSummary?: string;
  recentHistory: unknown[];
  recentEvents: AgentSessionEvent[];
  jevCapsule?: AgentSessionValueCapsule;
}
