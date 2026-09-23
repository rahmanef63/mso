import { expandOwnerStorePath } from "@/lib/owner-store-path.js";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpStore } from "./store-types";

const STORE_PATH = expandOwnerStorePath(process.env.OS_MCP_STORE ?? path.join(os.homedir(), ".mso", "mcp.json"));
const MAX_CLIENTS = 64;
const empty = (): McpStore => ({ clients: {}, codes: {}, tokens: {}, refreshTokens: {} });

export async function readMcpStore(): Promise<McpStore> {
  let raw: string;
  try {
    raw = await fs.readFile(STORE_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw error;
  }
  const parsed = JSON.parse(raw) as Partial<McpStore>;
  return {
    clients: parsed.clients ?? {},
    codes: parsed.codes ?? {},
    tokens: parsed.tokens ?? {},
    refreshTokens: parsed.refreshTokens ?? {},
  };
}

async function writeMcpStore(store: McpStore): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true, mode: 0o700 });
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, STORE_PATH);
}

let mutationChain: Promise<unknown> = Promise.resolve();

export function mutateMcpStore<T>(fn: () => Promise<T>): Promise<T> {
  const locked = () => withSecurityStoreLock(STORE_PATH, fn);
  const run = mutationChain.then(locked, locked);
  mutationChain = run.then(() => undefined, () => undefined);
  return run;
}

export function sweepMcpStore(store: McpStore): McpStore {
  const now = Date.now();
  for (const [key, value] of Object.entries(store.codes)) {
    if (value.expiresAt < now) delete store.codes[key];
  }
  for (const [key, value] of Object.entries(store.refreshTokens)) {
    if (value.expiresAt < now || value.revokedAt) delete store.refreshTokens[key];
  }
  return store;
}

function referencedClientIds(store: McpStore): Set<string> {
  const now = Date.now();
  return new Set([
    ...Object.values(store.codes).filter((row) => row.expiresAt >= now).map((row) => row.clientId),
    ...Object.values(store.tokens).filter((row) => !row.revokedAt && (row.expiresAt === 0 || row.expiresAt >= now)).map((row) => row.clientId),
    ...Object.values(store.refreshTokens).filter((row) => !row.revokedAt && (row.expiresAt === 0 || row.expiresAt >= now)).map((row) => row.clientId),
  ].filter(Boolean));
}

export function pruneUnreferencedClients(store: McpStore): void {
  const ids = Object.keys(store.clients);
  if (ids.length < MAX_CLIENTS) return;
  const referenced = referencedClientIds(store);
  const removable = ids
    .filter((id) => !referenced.has(id))
    .sort((a, b) => store.clients[a].createdAt - store.clients[b].createdAt);
  const removeCount = Math.min(removable.length, ids.length - MAX_CLIENTS + 1);
  for (const id of removable.slice(0, removeCount)) delete store.clients[id];
}

export async function commitMcpStore(store: McpStore): Promise<void> {
  await writeMcpStore(store);
}
