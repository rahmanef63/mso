import { expandOwnerStorePath } from "@/lib/owner-store-path.js";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import os from "node:os";
import path from "node:path";
import { SESSION_ID } from "./session-files";
import { readLocalAgentStore, writeLocalAgentStore } from "./local-agent-private-store";
import type { LocalAgentStandbyRecord, LocalAgentStandbyState } from "./local-agent-types";

export type LocalAgentStandbyStore = { version: 1; entries: LocalAgentStandbyRecord[] };
const MAX_STORE_BYTES = 1024 * 1024;
const MAX_ENTRIES = 1000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const STORE_PATH = expandOwnerStorePath(
  process.env.OS_LOCAL_AGENT_STANDBY_STORE ??
    path.join(os.homedir(), ".mso", "private", "local-agent-standby.json"),
);
const EMPTY: LocalAgentStandbyStore = { version: 1, entries: [] };

function validRecord(value: unknown): value is LocalAgentStandbyRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as LocalAgentStandbyRecord;
  return SESSION_ID.test(String(row.sessionId || "")) &&
    /^[a-f0-9]{64}$/.test(String(row.principalHash || "")) &&
    typeof row.principal === "string" && row.principal.length > 0 && row.principal.length <= 512 &&
    typeof row.workflowActor === "string" && row.workflowActor.length > 0 && row.workflowActor.length <= 512 &&
    /^[a-f0-9-]{36}$/.test(String(row.workflowId || "")) &&
    typeof row.armed === "boolean" &&
    ["waiting", "working", "blocked"].includes(String(row.state)) &&
    Number.isFinite(Date.parse(String(row.armedAt || ""))) &&
    Number.isFinite(Date.parse(String(row.updatedAt || ""))) &&
    (!row.executionLeaseUntil || Number.isFinite(Date.parse(row.executionLeaseUntil))) &&
    (!row.lastRunAt || Number.isFinite(Date.parse(row.lastRunAt))) &&
    (!row.currentMessageId || /^localmsg_[0-9a-f-]{36}$/.test(row.currentMessageId)) &&
    (!row.lastMessageId || /^localmsg_[0-9a-f-]{36}$/.test(row.lastMessageId)) &&
    (!row.currentTaskId || /^task_[0-9a-f-]{36}$/.test(row.currentTaskId)) &&
    (!row.claimedBy || row.claimedBy.length <= 160) &&
    (!row.lastError || row.lastError.length <= 500);
}

function validStore(value: unknown): value is LocalAgentStandbyStore {
  if (!value || typeof value !== "object") return false;
  const row = value as LocalAgentStandbyStore;
  return row.version === 1 && Array.isArray(row.entries) &&
    row.entries.length <= MAX_ENTRIES + 1 && row.entries.every(validRecord);
}

export async function readLocalAgentStandbyStore(): Promise<LocalAgentStandbyStore> {
  return readLocalAgentStore(STORE_PATH, MAX_STORE_BYTES, EMPTY, validStore);
}

function effectiveState(row: LocalAgentStandbyRecord, now = Date.now()): LocalAgentStandbyState {
  if (row.state === "working" && row.executionLeaseUntil &&
    Date.parse(row.executionLeaseUntil) <= now) return "waiting";
  return row.state;
}

export function standbyRecordView(
  row: LocalAgentStandbyRecord,
  now = Date.now(),
): LocalAgentStandbyRecord {
  return { ...row, state: effectiveState(row, now) };
}

function prune(entries: LocalAgentStandbyRecord[], now = Date.now()): LocalAgentStandbyRecord[] {
  return entries
    .filter((row) => row.armed || now - Date.parse(row.updatedAt) <= RETENTION_MS)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .slice(-MAX_ENTRIES);
}

export async function mutateLocalAgentStandbyStore<T>(
  mutate: (store: LocalAgentStandbyStore) => Promise<T> | T,
  options: { prune?: boolean; now?: number } = {},
): Promise<T> {
  return withSecurityStoreLock(STORE_PATH, async () => {
    const store = await readLocalAgentStandbyStore();
    const result = await mutate(store);
    if (options.prune) store.entries = prune(store.entries, options.now);
    await writeLocalAgentStore(STORE_PATH, store, MAX_STORE_BYTES);
    return result;
  });
}

export function clearStandbyExecution(row: LocalAgentStandbyRecord): void {
  delete row.currentMessageId;
  delete row.currentTaskId;
  delete row.executionLeaseUntil;
  delete row.claimedBy;
}
