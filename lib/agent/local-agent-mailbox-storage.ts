import { expandOwnerStorePath } from "@/lib/owner-store-path.js";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import os from "node:os";
import path from "node:path";
import { SESSION_ID } from "./session-files";
import { readLocalAgentStore, writeLocalAgentStore } from "./local-agent-private-store";
import type {
  LocalAgentMessageExecution,
  LocalAgentMessageView,
  LocalAgentStoredMessage,
} from "./local-agent-types";

export type LocalAgentMailboxStore = { version: 1; messages: LocalAgentStoredMessage[] };
const MAX_STORE_BYTES = 4 * 1024 * 1024;
const MAX_MESSAGES = 2000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const STORE_PATH = expandOwnerStorePath(
  process.env.OS_LOCAL_AGENT_MESSAGE_STORE ??
    path.join(os.homedir(), ".mso", "private", "local-agent-messages.json"),
);
const EMPTY: LocalAgentMailboxStore = { version: 1, messages: [] };

function validExecution(value: unknown): value is LocalAgentMessageExecution {
  if (!value || typeof value !== "object") return false;
  const row = value as LocalAgentMessageExecution;
  return row.requested === true &&
    typeof row.authorized === "boolean" &&
    ["pending", "claimed", "completed", "failed"].includes(String(row.state)) &&
    (row.attempts === undefined || (Number.isInteger(row.attempts) && row.attempts >= 0 && row.attempts <= 1000)) &&
    (!row.claimedBy || (typeof row.claimedBy === "string" && row.claimedBy.length <= 160)) &&
    (!row.claimLeaseUntil || Number.isFinite(Date.parse(row.claimLeaseUntil))) &&
    (!row.taskId || /^task_[0-9a-f-]{36}$/.test(row.taskId)) &&
    (!row.completedAt || Number.isFinite(Date.parse(row.completedAt))) &&
    (!row.error || (typeof row.error === "string" && row.error.length <= 500));
}

function validMessage(value: unknown): value is LocalAgentStoredMessage {
  if (!value || typeof value !== "object") return false;
  const row = value as LocalAgentStoredMessage;
  return /^localmsg_[0-9a-f-]{36}$/.test(String(row.id || "")) &&
    /^[a-f0-9]{64}$/.test(String(row.principalHash || "")) &&
    SESSION_ID.test(String(row.senderSessionId || "")) &&
    SESSION_ID.test(String(row.targetSessionId || "")) &&
    typeof row.senderLabel === "string" && row.senderLabel.length <= 200 &&
    typeof row.targetLabel === "string" && row.targetLabel.length <= 200 &&
    ["message", "task"].includes(String(row.kind)) &&
    (!row.intent || ["request", "reply", "notify"].includes(String(row.intent))) &&
    (!row.correlationId || /^localcorr_[0-9a-f-]{36}$/.test(row.correlationId)) &&
    (!row.replyToMessageId || /^localmsg_[0-9a-f-]{36}$/.test(row.replyToMessageId)) &&
    (row.requiresUserRelay === undefined || typeof row.requiresUserRelay === "boolean") &&
    typeof row.text === "string" && Buffer.byteLength(row.text, "utf8") <= 16 * 1024 &&
    ["accepted", "queued", "delivered", "read"].includes(String(row.state)) &&
    (!row.execution || ((row.intent ?? "notify") === "request" && validExecution(row.execution))) &&
    Number.isFinite(Date.parse(String(row.createdAt || ""))) &&
    (!row.deliveredAt || Number.isFinite(Date.parse(row.deliveredAt))) &&
    (!row.readAt || Number.isFinite(Date.parse(row.readAt)));
}

function validStore(value: unknown): value is LocalAgentMailboxStore {
  if (!value || typeof value !== "object") return false;
  const row = value as LocalAgentMailboxStore;
  return row.version === 1 && Array.isArray(row.messages) &&
    row.messages.length <= MAX_MESSAGES && row.messages.every(validMessage);
}

export async function readLocalAgentMailboxStore(): Promise<LocalAgentMailboxStore> {
  return readLocalAgentStore(STORE_PATH, MAX_STORE_BYTES, EMPTY, validStore);
}

export function localAgentMessageView(row: LocalAgentStoredMessage): LocalAgentMessageView {
  const { principalHash: _principalHash, ...safe } = row;
  return {
    ...safe,
    intent: row.intent ?? "notify",
    requiresUserRelay: row.requiresUserRelay === true,
    ...(row.execution ? { execution: { ...row.execution } } : {}),
  };
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

export async function mutateLocalAgentMailboxStore<T>(
  mutate: (store: LocalAgentMailboxStore) => Promise<T> | T,
  options: { prune?: boolean } = {},
): Promise<T> {
  return withSecurityStoreLock(STORE_PATH, async () => {
    const store = await readLocalAgentMailboxStore();
    const result = await mutate(store);
    if (options.prune) store.messages = prune(store.messages);
    await writeLocalAgentStore(STORE_PATH, store, MAX_STORE_BYTES);
    return result;
  });
}
