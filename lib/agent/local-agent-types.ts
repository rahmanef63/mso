import type { AgentSessionSource, AgentSessionTitleSource } from "./session-types";

export type LocalAgentPresenceState = "ready" | "idle" | "busy" | "ended";
export type LocalAgentStatus = LocalAgentPresenceState | "offline";
export type LocalAgentMessageKind = "message" | "task";
export type LocalAgentMessageIntent = "request" | "reply" | "notify";
export type LocalAgentDeliveryStatus =
  | "accepted"
  | "delivered"
  | "queued"
  | "target_offline"
  | "failed";
export type LocalAgentStoredMessageState = "accepted" | "queued" | "delivered" | "read";

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
  createdAt: string;
  deliveredAt?: string;
  readAt?: string;
}
