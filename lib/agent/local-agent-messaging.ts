import { randomUUID } from "node:crypto";
import { redactText } from "@/lib/security/redact-text";
import { getAgentSession } from "./session-store";
import { principalHash } from "./session-files";
import { listLocalAgents, resolveLocalAgent } from "./local-agent-directory";
import { enqueueLocalAgentMessage, getLocalAgentInboxMessage, listLocalAgentInbox, updateLocalAgentMessageState } from "./local-agent-mailbox";
import { publishLocalAgentMessage } from "./local-agent-events";
import type { LocalAgentDeliveryStatus, LocalAgentMessageIntent, LocalAgentMessageKind, LocalAgentMessageView, LocalAgentTarget } from "./local-agent-types";

export const MAX_LOCAL_AGENT_MESSAGE_BYTES = 16 * 1024;

function safePayload(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("local agent message is required");
  if (Buffer.byteLength(raw, "utf8") > MAX_LOCAL_AGENT_MESSAGE_BYTES)
    throw new Error("local agent message must be 16 KiB or smaller");
  const text = raw.replace(/\r/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\t/g, "  ");
  return redactText(text, MAX_LOCAL_AGENT_MESSAGE_BYTES);
}

function messageKind(value?: string): LocalAgentMessageKind {
  if (!value || value === "message") return "message";
  if (value === "task") return "task";
  throw new Error("local agent message kind must be message or task");
}

function messageIntent(value?: string): LocalAgentMessageIntent {
  if (!value || value === "notify") return "notify";
  if (value === "request" || value === "reply") return value;
  throw new Error("local agent message intent must be request, reply, or notify");
}

function correlation(value?: string): string | undefined {
  if (!value) return undefined;
  if (!/^localcorr_[0-9a-f-]{36}$/.test(value)) throw new Error("invalid local agent correlation id");
  return value;
}

async function senderTarget(principal: string, sessionId: string): Promise<LocalAgentTarget> {
  const session = await getAgentSession(principal, sessionId);
  if (!session) throw new Error("local agent sender not found for this client");
  const rows = await listLocalAgents(principal, { includeOffline: true });
  const row = rows.find((item) => item.id === sessionId);
  if (!row) throw new Error("local agent sender is not live");
  return row;
}

export async function sendLocalAgentMessage(input: {
  principal: string;
  senderSessionId: string;
  target: string;
  text: string;
  kind?: string;
  intent?: string;
  correlationId?: string;
  replyToMessageId?: string;
  requiresUserRelay?: boolean;
}): Promise<{
  status: LocalAgentDeliveryStatus;
  targetStatus: LocalAgentTarget["status"];
  sender: LocalAgentTarget;
  target: LocalAgentTarget;
  message: LocalAgentMessageView;
}> {
  const [sender, target] = await Promise.all([
    senderTarget(input.principal, input.senderSessionId),
    resolveLocalAgent(input.principal, input.target, input.senderSessionId),
  ]);
  const text = safePayload(input.text);
  const kind = messageKind(input.kind);
  const intent = messageIntent(input.intent);
  if (intent === "reply" && !input.replyToMessageId) throw new Error("local agent reply requires replyToMessageId");
  const correlationId = correlation(input.correlationId) ?? (intent === "request" ? `localcorr_${randomUUID()}` : undefined);
  const owner = principalHash(input.principal);
  const targetOffline = target.status === "offline" || target.status === "ended";
  const busy = target.status === "busy";
  let message = await enqueueLocalAgentMessage({
    principalHash: owner,
    senderSessionId: sender.id,
    senderLabel: sender.label,
    targetSessionId: target.id,
    targetLabel: target.label,
    kind,
    intent,
    ...(correlationId ? { correlationId } : {}),
    ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
    requiresUserRelay: input.requiresUserRelay === true,
    text,
    state: busy || targetOffline ? "queued" : "accepted",
  });

  let status: LocalAgentDeliveryStatus = targetOffline ? "target_offline" : busy ? "queued" : "accepted";
  if (!targetOffline && !busy && publishLocalAgentMessage(target.id, message) > 0) {
    const [updated] = await updateLocalAgentMessageState(input.principal, target.id, [message.id], "delivered");
    if (updated) message = updated;
    status = "delivered";
  }
  return { status, targetStatus: target.status, sender, target, message };
}

export async function replyLocalAgentMessage(input: {
  principal: string;
  senderSessionId: string;
  replyToMessageId: string;
  text: string;
  kind?: string;
}) {
  const original = await getLocalAgentInboxMessage(input.principal, input.senderSessionId, input.replyToMessageId);
  if (!original) throw new Error("local agent request message not found");
  if (original.intent !== "request" || !original.correlationId)
    throw new Error("local agent message is not a correlated request");
  const reply = await sendLocalAgentMessage({
    principal: input.principal,
    senderSessionId: input.senderSessionId,
    target: original.senderSessionId,
    text: input.text,
    kind: input.kind,
    intent: "reply",
    correlationId: original.correlationId,
    replyToMessageId: original.id,
    requiresUserRelay: original.requiresUserRelay,
  });
  await updateLocalAgentMessageState(input.principal, input.senderSessionId, [original.id], "read");
  return reply;
}

export async function flushLocalAgentQueue(principal: string, targetSessionId: string): Promise<number> {
  const pending = (await listLocalAgentInbox(principal, targetSessionId, { limit: 200 }))
    .filter((row) => row.state === "queued" || row.state === "accepted");
  let delivered = 0;
  for (const message of pending) {
    if (publishLocalAgentMessage(targetSessionId, message) <= 0) continue;
    await updateLocalAgentMessageState(principal, targetSessionId, [message.id], "delivered");
    delivered += 1;
  }
  return delivered;
}
