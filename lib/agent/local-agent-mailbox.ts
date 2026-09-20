import { randomUUID } from "node:crypto";
import { getAgentSession } from "./session-store";
import { principalHash } from "./session-files";
import {
  localAgentMessageView,
  mutateLocalAgentMailboxStore,
  readLocalAgentMailboxStore,
} from "./local-agent-mailbox-storage";
import type {
  LocalAgentMessageView,
  LocalAgentStoredMessage,
  LocalAgentStoredMessageState,
} from "./local-agent-types";

const DEFAULT_CLAIM_LEASE_MS = 15 * 60_000;
const MESSAGE_ID = /^localmsg_[0-9a-f-]{36}$/;

async function requireSession(principal: string, sessionId: string, label = "target"): Promise<void> {
  if (!await getAgentSession(principal, sessionId))
    throw new Error(`local agent ${label} not found for this client`);
}

export async function enqueueLocalAgentMessage(
  input: Omit<LocalAgentStoredMessage, "id" | "createdAt">,
): Promise<LocalAgentMessageView> {
  const row: LocalAgentStoredMessage = {
    ...input,
    id: `localmsg_${randomUUID()}`,
    createdAt: new Date().toISOString(),
  };
  return mutateLocalAgentMailboxStore((store) => {
    store.messages.push(row);
    return localAgentMessageView(row);
  }, { prune: true });
}

export async function getLocalAgentInboxMessage(
  principal: string,
  targetSessionId: string,
  messageId: string,
): Promise<LocalAgentMessageView | null> {
  await requireSession(principal, targetSessionId);
  if (!MESSAGE_ID.test(messageId)) throw new Error("invalid local agent message id");
  const owner = principalHash(principal);
  const row = (await readLocalAgentMailboxStore()).messages.find((message) =>
    message.principalHash === owner &&
    message.targetSessionId === targetSessionId &&
    message.id === messageId,
  );
  return row ? localAgentMessageView(row) : null;
}

export async function updateLocalAgentMessageState(
  principal: string,
  targetSessionId: string,
  messageIds: string[],
  state: LocalAgentStoredMessageState,
): Promise<LocalAgentMessageView[]> {
  await requireSession(principal, targetSessionId);
  const owner = principalHash(principal);
  const wanted = new Set(messageIds.filter((id) => MESSAGE_ID.test(id)).slice(0, 200));
  if (!wanted.size) return [];
  return mutateLocalAgentMailboxStore((store) => {
    const now = new Date().toISOString();
    const changed: LocalAgentMessageView[] = [];
    for (const row of store.messages) {
      if (row.principalHash !== owner ||
        row.targetSessionId !== targetSessionId ||
        !wanted.has(row.id)) continue;
      row.state = state;
      if ((state === "delivered" || state === "read") && !row.deliveredAt) row.deliveredAt = now;
      if (state === "read") row.readAt = now;
      changed.push(localAgentMessageView(row));
    }
    return changed;
  });
}

export async function getLocalAgentSentMessage(
  principal: string,
  senderSessionId: string,
  messageId: string,
): Promise<LocalAgentMessageView | null> {
  await requireSession(principal, senderSessionId, "sender");
  if (!MESSAGE_ID.test(messageId)) throw new Error("invalid local agent message id");
  const owner = principalHash(principal);
  const row = (await readLocalAgentMailboxStore()).messages.find((message) =>
    message.principalHash === owner &&
    message.senderSessionId === senderSessionId &&
    message.id === messageId,
  );
  return row ? localAgentMessageView(row) : null;
}

export async function findLocalAgentReply(
  principal: string,
  targetSessionId: string,
  replyToMessageId: string,
): Promise<LocalAgentMessageView | null> {
  await requireSession(principal, targetSessionId);
  if (!MESSAGE_ID.test(replyToMessageId)) throw new Error("invalid local agent message id");
  const owner = principalHash(principal);
  const row = (await readLocalAgentMailboxStore()).messages
    .filter((message) => message.principalHash === owner &&
      message.targetSessionId === targetSessionId &&
      message.intent === "reply" &&
      message.replyToMessageId === replyToMessageId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  return row ? localAgentMessageView(row) : null;
}

export async function listLocalAgentInbox(
  principal: string,
  targetSessionId: string,
  options: { includeRead?: boolean; limit?: number } = {},
): Promise<LocalAgentMessageView[]> {
  await requireSession(principal, targetSessionId);
  const owner = principalHash(principal);
  const limit = Math.max(1, Math.min(200, Math.trunc(options.limit || 100)));
  return (await readLocalAgentMailboxStore()).messages
    .filter((row) => row.principalHash === owner && row.targetSessionId === targetSessionId)
    .filter((row) => options.includeRead || row.state !== "read")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-limit)
    .map(localAgentMessageView);
}

function executionClaimable(row: LocalAgentStoredMessage, now = Date.now()): boolean {
  const execution = row.execution;
  if (!execution?.requested || !execution.authorized) return false;
  if (execution.state === "completed" || execution.state === "failed") return false;
  if (execution.state === "pending") return true;
  return execution.state === "claimed" &&
    Boolean(execution.claimLeaseUntil) &&
    Date.parse(execution.claimLeaseUntil!) <= now;
}

export async function listLocalAgentExecutableInbox(
  principal: string,
  targetSessionId: string,
  limit = 200,
  now = Date.now(),
): Promise<LocalAgentMessageView[]> {
  await requireSession(principal, targetSessionId);
  const owner = principalHash(principal);
  return (await readLocalAgentMailboxStore()).messages
    .filter((row) => row.principalHash === owner && row.targetSessionId === targetSessionId)
    .filter((row) => (row.intent ?? "notify") === "request" && executionClaimable(row, now))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, Math.max(1, Math.min(200, Math.trunc(limit) || 200)))
    .map(localAgentMessageView);
}

export async function countLocalAgentExecutableMessages(
  principal: string,
  targetSessionId: string,
): Promise<number> {
  return (await listLocalAgentExecutableInbox(principal, targetSessionId, 200)).length;
}

export async function claimLocalAgentMessageExecution(input: {
  principal: string;
  targetSessionId: string;
  messageId: string;
  claimedBy: string;
  now?: number;
}): Promise<LocalAgentMessageView | null> {
  await requireSession(input.principal, input.targetSessionId);
  const owner = principalHash(input.principal);
  const now = input.now ?? Date.now();
  return mutateLocalAgentMailboxStore((store) => {
    const row = store.messages.find((message) =>
      message.principalHash === owner &&
      message.targetSessionId === input.targetSessionId &&
      message.id === input.messageId,
    );
    if (!row || !executionClaimable(row, now) || !row.execution) return null;
    row.execution.state = "claimed";
    row.execution.claimedBy = input.claimedBy.slice(0, 160);
    row.execution.claimLeaseUntil = new Date(now + DEFAULT_CLAIM_LEASE_MS).toISOString();
    row.execution.attempts = (row.execution.attempts ?? 0) + 1;
    return localAgentMessageView(row);
  });
}

export async function finishLocalAgentMessageExecution(input: {
  principal: string;
  targetSessionId: string;
  messageId: string;
  claimedBy: string;
  state: "completed" | "failed";
  taskId?: string;
  error?: string;
}): Promise<LocalAgentMessageView | null> {
  await requireSession(input.principal, input.targetSessionId);
  const owner = principalHash(input.principal);
  return mutateLocalAgentMailboxStore((store) => {
    const row = store.messages.find((message) =>
      message.principalHash === owner &&
      message.targetSessionId === input.targetSessionId &&
      message.id === input.messageId,
    );
    if (!row?.execution ||
      row.execution.state !== "claimed" ||
      row.execution.claimedBy !== input.claimedBy) return null;
    row.execution.state = input.state;
    row.execution.completedAt = new Date().toISOString();
    if (input.taskId) row.execution.taskId = input.taskId;
    if (input.error) row.execution.error = input.error.slice(0, 500);
    else delete row.execution.error;
    delete row.execution.claimLeaseUntil;
    return localAgentMessageView(row);
  });
}
