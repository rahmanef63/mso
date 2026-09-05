import { expandOwnerStorePath } from "@/lib/owner-store-path.js";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { getAgentSession } from "./session-store";
import { principalHash, SESSION_ID } from "./session-files";
import { readLocalAgentStore, writeLocalAgentStore } from "./local-agent-private-store";
import type { LocalAgentMessageView, LocalAgentStoredMessage, LocalAgentStoredMessageState } from "./local-agent-types";

type MailboxStore = { version: 1; messages: LocalAgentStoredMessage[] };
const MAX_STORE_BYTES = 4 * 1024 * 1024;
const MAX_MESSAGES = 2000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const STORE_PATH = expandOwnerStorePath(process.env.OS_LOCAL_AGENT_MESSAGE_STORE ?? path.join(os.homedir(), ".mso", "private", "local-agent-messages.json"));
const EMPTY: MailboxStore = { version: 1, messages: [] };

function validMessage(value: unknown): value is LocalAgentStoredMessage {
  if (!value || typeof value !== "object") return false;
  const row = value as LocalAgentStoredMessage;
  return /^localmsg_[0-9a-f-]{36}$/.test(String(row.id || "")) && /^[a-f0-9]{64}$/.test(String(row.principalHash || "")) &&
    SESSION_ID.test(String(row.senderSessionId || "")) && SESSION_ID.test(String(row.targetSessionId || "")) &&
    typeof row.senderLabel === "string" && row.senderLabel.length <= 200 && typeof row.targetLabel === "string" && row.targetLabel.length <= 200 &&
    ["message", "task"].includes(String(row.kind)) && (!row.intent || ["request", "reply", "notify"].includes(String(row.intent))) &&
    (!row.correlationId || /^localcorr_[0-9a-f-]{36}$/.test(row.correlationId)) && (!row.replyToMessageId || /^localmsg_[0-9a-f-]{36}$/.test(row.replyToMessageId)) &&
    (row.requiresUserRelay === undefined || typeof row.requiresUserRelay === "boolean") && typeof row.text === "string" && Buffer.byteLength(row.text, "utf8") <= 16 * 1024 &&
    ["accepted", "queued", "delivered", "read"].includes(String(row.state)) && Number.isFinite(Date.parse(String(row.createdAt || ""))) &&
    (!row.deliveredAt || Number.isFinite(Date.parse(row.deliveredAt))) && (!row.readAt || Number.isFinite(Date.parse(row.readAt)));
}

function validStore(value: unknown): value is MailboxStore {
  if (!value || typeof value !== "object") return false;
  const row = value as MailboxStore;
  return row.version === 1 && Array.isArray(row.messages) && row.messages.length <= MAX_MESSAGES && row.messages.every(validMessage);
}

async function readStore(): Promise<MailboxStore> {
  return readLocalAgentStore(STORE_PATH, MAX_STORE_BYTES, EMPTY, validStore);
}

function view(row: LocalAgentStoredMessage): LocalAgentMessageView {
  const { principalHash: _principalHash, ...safe } = row;
  return { ...safe, intent: row.intent ?? "notify", requiresUserRelay: row.requiresUserRelay === true };
}

function prune(messages: LocalAgentStoredMessage[], now = Date.now()): LocalAgentStoredMessage[] {
  return messages
    .filter((row) => {
      const created = Date.parse(row.createdAt);
      return Number.isFinite(created) && now - created <= RETENTION_MS;
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-MAX_MESSAGES);
}

export async function enqueueLocalAgentMessage(input: Omit<LocalAgentStoredMessage, "id" | "createdAt">): Promise<LocalAgentMessageView> {
  const now = new Date().toISOString();
  const row: LocalAgentStoredMessage = {
    ...input,
    id: `localmsg_${randomUUID()}`,
    createdAt: now,
  };
  return withSecurityStoreLock(STORE_PATH, async () => {
    const store = await readStore();
    store.messages = prune([...store.messages, row]);
    await writeLocalAgentStore(STORE_PATH, store, MAX_STORE_BYTES);
    return view(row);
  });
}


export async function getLocalAgentInboxMessage(
  principal: string,
  targetSessionId: string,
  messageId: string,
): Promise<LocalAgentMessageView | null> {
  const session = await getAgentSession(principal, targetSessionId);
  if (!session) throw new Error("local agent target not found for this client");
  if (!/^localmsg_[0-9a-f-]{36}$/.test(messageId)) throw new Error("invalid local agent message id");
  const owner = principalHash(principal);
  const row = (await readStore()).messages.find((message) =>
    message.principalHash === owner && message.targetSessionId === targetSessionId && message.id === messageId,
  );
  return row ? view(row) : null;
}

export async function updateLocalAgentMessageState(
  principal: string,
  targetSessionId: string,
  messageIds: string[],
  state: LocalAgentStoredMessageState,
): Promise<LocalAgentMessageView[]> {
  const session = await getAgentSession(principal, targetSessionId);
  if (!session) throw new Error("local agent target not found for this client");
  const owner = principalHash(principal);
  const wanted = new Set(messageIds.filter((id) => /^localmsg_[0-9a-f-]{36}$/.test(id)).slice(0, 200));
  if (!wanted.size) return [];
  return withSecurityStoreLock(STORE_PATH, async () => {
    const store = await readStore();
    const now = new Date().toISOString();
    const changed: LocalAgentMessageView[] = [];
    for (const row of store.messages) {
      if (row.principalHash !== owner || row.targetSessionId !== targetSessionId || !wanted.has(row.id)) continue;
      row.state = state;
      if ((state === "delivered" || state === "read") && !row.deliveredAt) row.deliveredAt = now;
      if (state === "read") row.readAt = now;
      changed.push(view(row));
    }
    await writeLocalAgentStore(STORE_PATH, store, MAX_STORE_BYTES);
    return changed;
  });
}


export async function getLocalAgentSentMessage(
  principal: string,
  senderSessionId: string,
  messageId: string,
): Promise<LocalAgentMessageView | null> {
  const session = await getAgentSession(principal, senderSessionId);
  if (!session) throw new Error("local agent sender not found for this client");
  if (!/^localmsg_[0-9a-f-]{36}$/.test(messageId)) throw new Error("invalid local agent message id");
  const owner = principalHash(principal);
  const row = (await readStore()).messages.find((message) =>
    message.principalHash === owner && message.senderSessionId === senderSessionId && message.id === messageId,
  );
  return row ? view(row) : null;
}

export async function findLocalAgentReply(
  principal: string,
  targetSessionId: string,
  replyToMessageId: string,
): Promise<LocalAgentMessageView | null> {
  const session = await getAgentSession(principal, targetSessionId);
  if (!session) throw new Error("local agent target not found for this client");
  if (!/^localmsg_[0-9a-f-]{36}$/.test(replyToMessageId)) throw new Error("invalid local agent message id");
  const owner = principalHash(principal);
  const row = (await readStore()).messages
    .filter((message) => message.principalHash === owner && message.targetSessionId === targetSessionId &&
      message.intent === "reply" && message.replyToMessageId === replyToMessageId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  return row ? view(row) : null;
}

export async function listLocalAgentInbox(
  principal: string,
  targetSessionId: string,
  options: { includeRead?: boolean; limit?: number } = {},
): Promise<LocalAgentMessageView[]> {
  const session = await getAgentSession(principal, targetSessionId);
  if (!session) throw new Error("local agent target not found for this client");
  const owner = principalHash(principal);
  const limit = Math.max(1, Math.min(200, Math.trunc(options.limit || 100)));
  return (await readStore()).messages
    .filter((row) => row.principalHash === owner && row.targetSessionId === targetSessionId)
    .filter((row) => options.includeRead || row.state !== "read")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-limit)
    .map(view);
}
