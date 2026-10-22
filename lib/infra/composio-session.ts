import { constants, promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pinSecurityStorePath } from "@/lib/security-store-path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { normalizeMcpEndpoint } from "./mcp-policy";
import { request, obj } from "./http";
import { COMPOSIO_API_BASE, COMPOSIO_CONNECT_KEY_MESSAGE, composioAuthHeader } from "./composio";
import { INFRA_STORE_PATH, readIntegrationState } from "./connection-storage";
import { IntegrationError, resolveUser } from "./identity";
import { currentIntegrationSelection } from "./connection-service";
import type { InfraProviderValues } from "./types";

/**
 * Per-end-user Composio session and its hosted MCP endpoint.
 *
 * Verified against the live Platform API surface (`POST /api/v3.1/tool_router/session`
 * in `backend.composio.dev/api/v3.1/openapi.json`, spec 3.1.0):
 *
 * - The REQUEST schema has no `mcp` field (props: user_id, toolkits, auth_configs,
 *   connected_accounts, instant, manage_connections, tools, tags, workbench,
 *   proxy_execute, multi_account, experimental, preload, hooks, search, execute).
 *   `mcp: true` in the SDKs is client-side sugar only.
 * - The 201 RESPONSE carries `mcp: {type, url}` and no `headers` member.
 *
 * Therefore the MCP endpoint has no credential of its own to hand out: the client
 * credential IS the session credential. `docs/sessions-via-mcp` says
 * `session.mcp.headers` holds exactly "the credential the SDK used to create or load
 * the session, and nothing else. No other default header and no ambient
 * COMPOSIO_API_KEY is copied in", and maps it per key kind: project → `x-api-key`,
 * user → `x-user-api-key`, org → `x-org-api-key`. That is byte-for-byte what
 * `composioAuthHeader` returns for the credential that authenticated this very create
 * call, so the composed header is derived from that one `auth` object - never from an
 * environment variable, never re-resolved, never a different key. If a future API
 * version does return `mcp.headers`, those win verbatim.
 *
 * `mcpHeaders` stays server-side: the HTTP route returns the URL only.
 */
const SESSION_URL = `${COMPOSIO_API_BASE}/tool_router/session`;
/** Same allowlist as Composio redirect links, plus the host the spec example returns. */
export const COMPOSIO_MCP_HOSTS = ["connect.composio.dev", "backend.composio.dev", "platform.composio.dev", "app.composio.dev"];
const MAX_STORE_BYTES = 256 * 1024;
const MAX_HEADERS = 32;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
const KEY_PART = /^[A-Za-z0-9:_.-]{1,200}$/;

export type ComposioSession = {
  sessionId: string;
  mcpUrl: string;
  /** The credential the SDK exports for this session URL: composed from the key that authenticated the create call. Server-side only. */
  mcpHeaders: Record<string, string>;
  expiresAt?: number;
};

export type ComposioSessionResolution = ComposioSession & { reused: boolean; user: string };

type StoredSession = ComposioSession & { instanceId: string; userUid: string; createdAt: number };
type Store = { version: 1; sessions: Record<string, StoredSession> };

/** Owner-only, beside `infra-providers.json`: 0700 parent, 0600 file, O_NOFOLLOW, uid-checked. */
export const composioSessionStorePath = () => path.join(path.dirname(INFRA_STORE_PATH), "composio-sessions.json");

/** One helper for every message this module throws: an upstream body can echo a credential. */
export function redactComposioMessage(message: string, secrets: (string | undefined)[]): string {
  let out = message;
  for (const secret of secrets) if (secret && secret.length >= 6) out = out.split(secret).join("[redacted]");
  return out;
}

function connectKeyRefusal(): IntegrationError {
  const error = new IntegrationError("composio_connect_key_wrong_provider", 409);
  error.message = COMPOSIO_CONNECT_KEY_MESSAGE;
  return error;
}

function headerMap(value: unknown): Record<string, string> {
  const raw = obj(value);
  const entries = Object.entries(raw);
  if (entries.length > MAX_HEADERS) throw new IntegrationError("invalid_composio_session_headers", 502);
  const headers: Record<string, string> = {};
  for (const [name, entry] of entries) {
    if (!HEADER_NAME.test(name) || typeof entry !== "string" || !entry || entry.length > 4096 || /[\r\n\0]/.test(entry)) {
      throw new IntegrationError("invalid_composio_session_headers", 502);
    }
    headers[name] = entry;
  }
  return headers;
}

/** Fail closed on a session URL pointing anywhere the session could not live. */
function composioMcpUrl(raw: string): string {
  let href: string;
  try { href = normalizeMcpEndpoint(raw); } catch { throw new IntegrationError("invalid_composio_mcp_endpoint", 502); }
  if (!COMPOSIO_MCP_HOSTS.includes(new URL(href).hostname)) throw new IntegrationError("invalid_composio_mcp_host", 502);
  return href;
}

/**
 * POST a session for one end user. Server-side only: the caller's credential is sent
 * in the same header `composioAuthHeader` already selects, and a ck_ key is refused
 * before any request is made.
 */
export async function createComposioSession(input: {
  values: InfraProviderValues;
  userId: string;
  toolkits?: string[];
  authConfigs?: Record<string, string>;
  fetchImpl?: (value: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}): Promise<ComposioSession> {
  const secrets = [input.values.apiKey, input.values.orgApiKey];
  if (!/^[\x20-\x7e]{1,200}$/.test(input.userId) || !input.userId.trim()) throw new IntegrationError("invalid_composio_user_id", 400);
  // composioAuthHeader is the single key-detection path: it throws for a ck_ Connect
  // key before any request, and the Platform API would answer that key with a
  // misleading 401.
  let auth;
  try { auth = composioAuthHeader(input.values); }
  catch { throw connectKeyRefusal(); }
  if (!auth) throw new IntegrationError("composio_project_key_required", 409);

  const body: Record<string, unknown> = { user_id: input.userId };
  if (input.toolkits?.length) body.toolkits = { enable: input.toolkits };
  if (input.authConfigs && Object.keys(input.authConfigs).length) body.auth_configs = input.authConfigs;

  let response;
  try {
    response = await request(SESSION_URL, {
      method: "POST",
      headers: { ...auth.header, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    }, undefined, input.fetchImpl);
  } catch (error) {
    throw new IntegrationError(redactComposioMessage(`composio_session_unreachable: ${(error as Error).message}`, secrets), 502);
  }
  if (!response.ok) {
    const slug = String(obj(obj(response.body).error).slug ?? "");
    const safe = /^[A-Za-z0-9_]{1,80}$/.test(slug) ? ` ${slug}` : "";
    // The response body is not echoed: it can contain the credential the request carried.
    throw new IntegrationError(redactComposioMessage(`composio_session_failed (${response.status})${safe}`, secrets), response.status === 401 || response.status === 403 ? 401 : 502);
  }

  const payload = obj(response.body);
  const mcp = obj(payload.mcp);
  const sessionId = typeof payload.session_id === "string" ? payload.session_id.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(sessionId)) throw new IntegrationError("invalid_composio_session_response", 502);
  const mcpUrl = composioMcpUrl(String(mcp.url ?? ""));
  // Response wins; composed credential is the documented fallback.
  let mcpHeaders: Record<string, string>;
  try {
    const returned = headerMap(mcp.headers);
    mcpHeaders = Object.keys(returned).length ? returned : { ...auth.header };
  } catch (error) { throw new IntegrationError(redactComposioMessage((error as Error).message, [...secrets, ...Object.values(obj(mcp.headers)) as string[]]), 502); }
  return { sessionId, mcpUrl, mcpHeaders };
}

function parseStore(value: unknown): Store {
  const raw = obj(value);
  const bad = (): never => { throw new IntegrationError("invalid_composio_session_store"); };
  if (raw.version !== 1 || !raw.sessions || typeof raw.sessions !== "object" || Array.isArray(raw.sessions)) bad();
  const sessions: Record<string, StoredSession> = {};
  for (const [key, entry] of Object.entries(raw.sessions as Record<string, unknown>)) {
    const row = obj(entry);
    const keyParts = key.split(":");
    if (keyParts.length !== 2 || keyParts.some((part) => !KEY_PART.test(part))) bad();
    const { sessionId, instanceId, userUid, createdAt, expiresAt, mcpUrl: rawUrl } = row;
    const id = typeof sessionId === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(sessionId) ? sessionId : bad();
    const instance = typeof instanceId === "string" ? instanceId : bad();
    const uid = typeof userUid === "string" ? userUid : bad();
    const created = Number.isSafeInteger(createdAt) ? createdAt as number : bad();
    let mcpUrl: string;
    try {
      mcpUrl = normalizeMcpEndpoint(String(rawUrl ?? ""));
      if (!COMPOSIO_MCP_HOSTS.includes(new URL(mcpUrl).hostname)) return bad();
    } catch { return bad(); }
    sessions[key] = {
      sessionId: id, mcpUrl, mcpHeaders: headerMap(row.mcpHeaders),
      instanceId: instance, userUid: uid, createdAt: created,
      ...(Number.isFinite(expiresAt) ? { expiresAt: Number(expiresAt) } : {}),
    };
  }
  return { version: 1, sessions };
}

export async function readComposioSessions(): Promise<Store> {
  const pinned = await pinSecurityStorePath(composioSessionStorePath());
  let handle;
  try {
    handle = await fs.open(pinned.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_STORE_BYTES || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) throw new IntegrationError("unsafe_composio_session_store");
    return parseStore(JSON.parse(await handle.readFile("utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, sessions: {} };
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError("invalid_composio_session_store");
  } finally { await handle?.close(); await pinned.directory.close(); }
}

async function writeComposioSessions(store: Store): Promise<void> {
  const pinned = await pinSecurityStorePath(composioSessionStorePath());
  const text = JSON.stringify(parseStore(store), null, 2) + "\n";
  try {
    if (Buffer.byteLength(text) > MAX_STORE_BYTES) throw new IntegrationError("composio_session_store_capacity", 409);
    const temporary = `${pinned.file}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, pinned.file);
    } finally { await fs.unlink(temporary).catch(() => undefined); }
    await pinned.directory.sync();
  } finally { await pinned.directory.close(); }
}

const storeKey = (instanceId: string, userUid: string) => {
  if (!KEY_PART.test(instanceId) || !KEY_PART.test(userUid) || instanceId.includes(":") || userUid.includes(":")) throw new IntegrationError("invalid_composio_session_key");
  return `${instanceId}:${userUid}`;
};

/** Never returns another MSO user's session: the key is (instance, credential-owner uid). */
export async function readComposioSession(instanceId: string, userUid: string): Promise<StoredSession | null> {
  const key = storeKey(instanceId, userUid);
  const row = (await readComposioSessions()).sessions[key];
  if (!row || row.instanceId !== instanceId || row.userUid !== userUid) return null;
  if (row.expiresAt !== undefined && row.expiresAt <= Date.now()) return null;
  return row;
}

export function composioRemoteUserId(instanceId: string, userUid: string): string {
  storeKey(instanceId, userUid);
  return `mso:${instanceId}:${userUid}`;
}

/**
 * Create-or-reuse for the credential owner selected server-side. Composio bills and
 * rate-limits per session and the session MCP endpoint is per-session, so a stored
 * session is reused until `refresh`. Sessions do not expire upstream, so a stored
 * row stays valid; a session deleted upstream surfaces when an agent calls it.
 */
export async function composioSessionForUser(input: {
  values: InfraProviderValues;
  user?: string;
  refresh?: boolean;
  toolkits?: string[];
  authConfigs?: Record<string, string>;
  fetchImpl?: (value: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}): Promise<ComposioSessionResolution> {
  const state = await readIntegrationState();
  const user = input.user ?? resolveUser(state, currentIntegrationSelection());
  const profile = state.users[user];
  if (!profile) throw new IntegrationError("user_not_found", 404);
  const instanceId = state.instanceId, userUid = profile.uid;
  if (!input.refresh) {
    const stored = await readComposioSession(instanceId, userUid);
    if (stored) return { sessionId: stored.sessionId, mcpUrl: stored.mcpUrl, mcpHeaders: stored.mcpHeaders, ...(stored.expiresAt !== undefined ? { expiresAt: stored.expiresAt } : {}), reused: true, user };
  }
  const created = await createComposioSession({
    values: input.values,
    userId: composioRemoteUserId(instanceId, userUid),
    toolkits: input.toolkits,
    authConfigs: input.authConfigs,
    fetchImpl: input.fetchImpl,
  });
  const key = storeKey(instanceId, userUid);
  await withSecurityStoreLock(composioSessionStorePath(), async () => {
    const store = await readComposioSessions();
    store.sessions[key] = { ...created, instanceId, userUid, createdAt: Date.now() };
    await writeComposioSessions(store);
  });
  return { ...created, reused: false, user };
}
