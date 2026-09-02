import os from "node:os";
import path from "node:path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { getAgentSession } from "./session-store";
import { principalHash, SESSION_ID } from "./session-files";
import { readLocalAgentStore, writeLocalAgentStore } from "./local-agent-private-store";
import type { LocalAgentPresenceRecord, LocalAgentPresenceState, LocalAgentStatus } from "./local-agent-types";

type PresenceStore = { version: 1; entries: LocalAgentPresenceRecord[] };
const MAX_STORE_BYTES = 512 * 1024;
const MAX_ENTRIES = 1000;
const OFFLINE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const STORE_PATH = process.env.OS_LOCAL_AGENT_PRESENCE_STORE ?? path.join(os.homedir(), ".mso", "private", "local-agent-presence.json");
const EMPTY: PresenceStore = { version: 1, entries: [] };

function validPresence(value: unknown): value is LocalAgentPresenceRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as LocalAgentPresenceRecord;
  return SESSION_ID.test(String(row.sessionId || "")) && /^[a-f0-9]{64}$/.test(String(row.principalHash || "")) &&
    /^agent-[a-z]+$/.test(String(row.alias || "")) && typeof row.instanceId === "string" && row.instanceId.length > 0 && row.instanceId.length <= 160 &&
    ["ready", "idle", "busy", "ended"].includes(String(row.state)) && Number.isFinite(Date.parse(String(row.lastSeenAt || ""))) &&
    Number.isFinite(Date.parse(String(row.leaseUntil || ""))) && (!row.endedAt || Number.isFinite(Date.parse(row.endedAt)));
}

function validStore(value: unknown): value is PresenceStore {
  if (!value || typeof value !== "object") return false;
  const row = value as PresenceStore;
  return row.version === 1 && Array.isArray(row.entries) && row.entries.length <= MAX_ENTRIES && row.entries.every(validPresence);
}

function leaseMs(): number {
  const raw = Number(process.env.OS_LOCAL_AGENT_LEASE_MS);
  return Number.isFinite(raw) ? Math.max(15_000, Math.min(300_000, Math.trunc(raw))) : 60_000;
}

function alphaOrdinal(index: number): string {
  let value = Math.max(0, Math.trunc(index));
  let out = "";
  do {
    out = String.fromCharCode(97 + (value % 26)) + out;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return out;
}

function allocateAlias(entries: LocalAgentPresenceRecord[], owner: string): string {
  const used = new Set(entries.filter((row) => row.principalHash === owner).map((row) => row.alias));
  for (let i = 0; i < MAX_ENTRIES * 2; i += 1) {
    const alias = `agent-${alphaOrdinal(i)}`;
    if (!used.has(alias)) return alias;
  }
  throw new Error("local agent alias space is exhausted");
}

async function readStore(): Promise<PresenceStore> {
  return readLocalAgentStore(STORE_PATH, MAX_STORE_BYTES, EMPTY, validStore);
}

function prune(entries: LocalAgentPresenceRecord[], now: number): LocalAgentPresenceRecord[] {
  return entries
    .filter((row) => {
      const last = Date.parse(row.endedAt || row.lastSeenAt);
      return Number.isFinite(last) && now - last <= OFFLINE_RETENTION_MS;
    })
    .sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt))
    .slice(-MAX_ENTRIES);
}

export function localAgentStatus(row: LocalAgentPresenceRecord, now = Date.now()): LocalAgentStatus {
  if (row.state === "ended") return "ended";
  return Date.parse(row.leaseUntil) > now ? row.state : "offline";
}

export async function touchLocalAgentPresence(
  principal: string,
  sessionId: string,
  state: Exclude<LocalAgentPresenceState, "ended">,
  instanceId: string,
  now = Date.now(),
): Promise<LocalAgentPresenceRecord> {
  const session = await getAgentSession(principal, sessionId);
  if (!session) throw new Error("local agent session not found for this client");
  if (!instanceId || instanceId.length > 160) throw new Error("invalid local agent instance id");
  const owner = principalHash(principal);
  return withSecurityStoreLock(STORE_PATH, async () => {
    const store = await readStore();
    const current = store.entries.find((row) => row.sessionId === sessionId && row.principalHash === owner);
    const at = new Date(now).toISOString();
    const next: LocalAgentPresenceRecord = {
      sessionId,
      principalHash: owner,
      alias: current?.alias || allocateAlias(store.entries, owner),
      instanceId: instanceId.slice(0, 160),
      state,
      lastSeenAt: at,
      leaseUntil: new Date(now + leaseMs()).toISOString(),
    };
    store.entries = prune(store.entries.filter((row) => !(row.sessionId === sessionId && row.principalHash === owner)), now);
    store.entries.push(next);
    await writeLocalAgentStore(STORE_PATH, store, MAX_STORE_BYTES);
    return next;
  });
}

export async function endLocalAgentPresence(
  principal: string,
  sessionId: string,
  instanceId: string,
  now = Date.now(),
): Promise<void> {
  const owner = principalHash(principal);
  await withSecurityStoreLock(STORE_PATH, async () => {
    const store = await readStore();
    const row = store.entries.find((entry) => entry.sessionId === sessionId && entry.principalHash === owner);
    if (!row || row.instanceId !== instanceId) return;
    const at = new Date(now).toISOString();
    Object.assign(row, { state: "ended", lastSeenAt: at, leaseUntil: at, endedAt: at });
    store.entries = prune(store.entries, now);
    await writeLocalAgentStore(STORE_PATH, store, MAX_STORE_BYTES);
  });
}

export async function listLocalAgentPresence(principal: string): Promise<LocalAgentPresenceRecord[]> {
  const owner = principalHash(principal);
  return (await readStore()).entries.filter((row) => row.principalHash === owner);
}
