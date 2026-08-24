import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sha256hex } from "./pkce";
import type { Scope } from "./scope";
import { withSecurityStoreLock } from "@/lib/security-store-lock";

// OAuth clients, authorization codes and bearer tokens for the MCP server.
// mso has no database, so this is the same shape lib/auth/device-store.ts uses:
// one JSON file under ~/.mso, written atomically (tmp + rename, 0600).
//
// SECRETS ARE NEVER STORED RAW. Codes and tokens live here as sha256 only; the
// raw value is returned to the client exactly once, at mint. A stolen copy of
// this file leaks WHAT was issued, not a usable credential.

export interface McpClient {
  name: string;
  redirectUris: string[];
  createdAt: number;
}

export interface McpCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: Scope;
  expiresAt: number;
}

export interface McpToken {
  label: string;
  clientId: string;
  scope: Scope;
  createdAt: number;
  expiresAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

interface Store {
  clients: Record<string, McpClient>;
  codes: Record<string, McpCode>;
  tokens: Record<string, McpToken>;
}

const STORE_PATH = process.env.OS_MCP_STORE ?? path.join(os.homedir(), ".mso", "mcp.json");

export const CODE_TTL_MS = 60_000; // RFC 6749 wants ≤10 min; the exchange is immediate
export const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90d — a forgotten bearer expires
const MAX_CLIENTS = 32;

const empty = (): Store => ({ clients: {}, codes: {}, tokens: {} });

// Same rule as device-store: "no file yet" is the ONLY failure that may read as an
// empty store. A corrupt file or EACCES must throw, because read() feeds a
// read-modify-write — swallowing it would silently erase every issued token and,
// worse, keep answering requests as if nothing had been revoked.
async function read(): Promise<Store> {
  let raw: string;
  try {
    raw = await fs.readFile(STORE_PATH, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw e;
  }
  const p = JSON.parse(raw) as Partial<Store>;
  return { clients: p.clients ?? {}, codes: p.codes ?? {}, tokens: p.tokens ?? {} };
}

async function write(store: Store): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true, mode: 0o700 });
  // Per-process temp name prevents an operator-side helper / another server process
  // from clobbering the exact temp path while this process is committing a write.
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, STORE_PATH);
}

// Every credential mutation is a read-modify-write. Atomic rename only makes ONE
// write indivisible; without serialising the whole transaction, concurrent requests
// can both read the same old state and then overwrite each other's decisions. That
// is security-significant here: a token touch must never resurrect a token that a
// concurrent revoke just killed, and an OAuth code must be consumable exactly once.
let mutationChain: Promise<unknown> = Promise.resolve();
function mutate<T>(fn: () => Promise<T>): Promise<T> {
  const locked = () => withSecurityStoreLock(STORE_PATH, fn);
  const run = mutationChain.then(locked, locked);
  mutationChain = run.then(() => undefined, () => undefined);
  return run;
}

/** Drop expired codes on every write path — they are single-use and short-lived,
 *  so without this the file grows one dead row per abandoned consent, forever. */
function sweep(store: Store): Store {
  const now = Date.now();
  for (const [k, v] of Object.entries(store.codes)) if (v.expiresAt < now) delete store.codes[k];
  return store;
}

export function registerClient(name: string, redirectUris: string[]): Promise<string> {
  return mutate(async () => {
    const store = sweep(await read());
    // Re-registering the same redirect set returns the existing id instead of
  // minting a new one — mcp-remote and Cursor re-register on every launch.
    const key = [...redirectUris].sort().join(" ");
    for (const [id, c] of Object.entries(store.clients)) {
      if ([...c.redirectUris].sort().join(" ") === key) return id;
    }
    const ids = Object.keys(store.clients);
    if (ids.length >= MAX_CLIENTS) {
      ids.sort((a, b) => store.clients[a].createdAt - store.clients[b].createdAt)
        .slice(0, ids.length - MAX_CLIENTS + 1)
        .forEach((id) => delete store.clients[id]);
    }
    const clientId = "mcpc_" + sha256hex(key + Date.now()).slice(0, 24);
    store.clients[clientId] = { name: name.slice(0, 80) || "MCP Client", redirectUris, createdAt: Date.now() };
    await write(store);
    return clientId;
  });
}

export async function getClient(clientId: string): Promise<McpClient | null> {
  return (await read()).clients[clientId] ?? null;
}

export function storeCode(code: string, rec: McpCode): Promise<void> {
  return mutate(async () => {
    const store = sweep(await read());
    store.codes[sha256hex(code)] = rec;
    await write(store);
  });
}

/**
 * Single-use exchange. The row is DELETED before the caller mints anything, so a
 * replayed code finds nothing and gets `invalid_grant` — and the table does not
 * grow a dead "consumed" row per successful login.
 */
export function consumeCode(code: string): Promise<McpCode | null> {
  return mutate(async () => {
    const store = sweep(await read());
    const hash = sha256hex(code);
    const rec = store.codes[hash];
    if (!rec || rec.expiresAt < Date.now()) return null;
    delete store.codes[hash];
    await write(store);
    return rec;
  });
}

export function storeToken(token: string, rec: Omit<McpToken, "createdAt" | "expiresAt">): Promise<void> {
  return mutate(async () => {
    const store = sweep(await read());
    const now = Date.now();
    store.tokens[sha256hex(token)] = { ...rec, createdAt: now, expiresAt: now + TOKEN_TTL_MS };
    await write(store);
  });
}

/** Returns the live token record, or null for unknown / revoked / expired. Both
 *  revocation and expiry are re-checked on EVERY call — that is what makes the
 *  Revoke button in Settings kill an in-flight connector immediately. */
export async function validateToken(token: string): Promise<(McpToken & { hash: string }) | null> {
  if (!token) return null;
  const hash = sha256hex(token);
  const rec = (await read()).tokens[hash];
  if (!rec || rec.revokedAt) return null;
  if (rec.expiresAt < Date.now()) return null;
  return { ...rec, hash };
}

export function touchToken(hash: string): Promise<void> {
  return mutate(async () => {
    const store = await read();
    const rec = store.tokens[hash];
    if (!rec) return;
    rec.lastUsedAt = Date.now();
    await write(store);
  });
}

export interface TokenView extends McpToken {
  id: string;
  /** Resolved HERE, not in the browser: the server owns the clock, and computing
   *  it during render is an impure read the React compiler rejects anyway. */
  status: "active" | "revoked" | "expired";
}

/** For the Settings table. There is no raw token to withhold — only the sha256
 *  was ever written — so the id here is a short prefix of the hash. */
export async function listTokens(): Promise<TokenView[]> {
  const store = await read();
  const now = Date.now();
  return Object.entries(store.tokens)
    .map(([hash, t]) => ({
      ...t,
      id: hash.slice(0, 16),
      status: t.revokedAt ? ("revoked" as const) : t.expiresAt < now ? ("expired" as const) : ("active" as const),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function revokeToken(id: string): Promise<boolean> {
  return mutate(async () => {
    const store = await read();
    const hit = Object.keys(store.tokens).find((h) => h.startsWith(id));
    if (!hit || store.tokens[hit].revokedAt) return false;
    store.tokens[hit].revokedAt = Date.now();
    await write(store);
    return true;
  });
}

/** Panic button — kills every live bearer at once. */
export function revokeAllTokens(): Promise<number> {
  return mutate(async () => {
    const store = await read();
    let n = 0;
    for (const t of Object.values(store.tokens)) if (!t.revokedAt) { t.revokedAt = Date.now(); n++; }
    if (n) await write(store);
    return n;
  });
}
