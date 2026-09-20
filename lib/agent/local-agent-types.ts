import type { AgentSessionSource, AgentSessionTitleSource } from "./session-types";

export type LocalAgentPresenceState = "ready" | "idle" | "busy" | "ended";
export type LocalAgentStatus = LocalAgentPresenceState | "offline";
export type LocalAgentMessageKind = "message" | "task";
export type LocalAgentMessageIntent = "request" | "reply" | "notify";
export type LocalAgentDeliveryStatus =
  | "accepted"
  | "accepted_for_standby"
  | "delivered"
  | "queued"
  | "target_offline"
  | "failed";
export type LocalAgentStoredMessageState = "accepted" | "queued" | "delivered" | "read";
export type LocalAgentStandbyState = "waiting" | "working" | "blocked";
export type LocalAgentMessageExecutionState = "pending" | "claimed" | "completed" | "failed";

export interface LocalAgentMessageExecution {
  requested: true;
  authorized: boolean;
  state: LocalAgentMessageExecutionState;
  attempts?: number;
  claimedBy?: string;
  claimLeaseUntil?: string;
  taskId?: string;
  completedAt?: string;
  error?: string;
}

export interface LocalAgentStandbyRecord {
  principalHash: string;
  principal: string;
  sessionId: string;
  workflowActor: string;
  workflowId: string;
  armed: boolean;
  state: LocalAgentStandbyState;
  armedAt: string;
  updatedAt: string;
  executionLeaseUntil?: string;
  claimedBy?: string;
  currentMessageId?: string;
  currentTaskId?: string;
  lastMessageId?: string;
  lastRunAt?: string;
  lastError?: string;
}

export interface LocalAgentPresenceRecord {
  sessionId: string;
  principalHash: string;
  alias: string;
  instanceId: string;
  state: LocalAgentPresenceState;
  lastSeenAt: string;
  leaseUntil: string;
  endedAt?: string;
}

export interface LocalAgentTarget {
  id: string;
  name: string;
  alias: string;
  label: string;
  source: AgentSessionSource;
  title: string;
  titleSource: AgentSessionTitleSource;
  status: LocalAgentStatus;
  consumerConnected: boolean;
  consumerCount: number;
  standbyArmed: boolean;
  standbyState?: LocalAgentStandbyState;
  standbyWorkflowId?: string;
  standbySince?: string;
  actionable: boolean;
  queuedCount: number;
  currentCommand?: string;
  cwd?: string;
  lastSeenAt: string;
}

export interface LocalAgentStoredMessage {
  id: string;
  principalHash: string;
  senderSessionId: string;
  senderLabel: string;
  targetSessionId: string;
  targetLabel: string;
  kind: LocalAgentMessageKind;
  intent?: LocalAgentMessageIntent;
  correlationId?: string;
  replyToMessageId?: string;
  requiresUserRelay?: boolean;
  text: string;
  state: LocalAgentStoredMessageState;
  execution?: LocalAgentMessageExecution;
  createdAt: string;
  deliveredAt?: string;
  readAt?: string;
}

export interface LocalAgentMessageView {
  id: string;
  senderSessionId: string;
  senderLabel: string;
  targetSessionId: string;
  targetLabel: string;
  kind: LocalAgentMessageKind;
  intent: LocalAgentMessageIntent;
  correlationId?: string;
  replyToMessageId?: string;
  requiresUserRelay: boolean;
  text: string;
  state: LocalAgentStoredMessageState;
  execution?: LocalAgentMessageExecution;
  createdAt: string;
  deliveredAt?: string;
  readAt?: string;
}
