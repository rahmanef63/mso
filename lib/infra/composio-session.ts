import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { request, obj } from "./http";
import { composioAuthHeader } from "./composio";
import { readIntegrationState } from "./connection-storage";
import { IntegrationError, resolveUser } from "./identity";
import { currentIntegrationSelection } from "./connection-service";
import type { InfraProviderValues } from "./types";
import {
  SESSION_URL, composioMcpUrl, connectKeyRefusal, headerMap, redactComposioMessage, type ComposioSession,
} from "./composio-session-contract";
import {
  composioRemoteUserId, composioSessionStorePath, readComposioSession, readComposioSessions, storeKey, writeComposioSessions,
} from "./composio-session-store";

// Public surface kept: the verified contract facts, host allowlist and store helpers live in
// composio-session-contract.ts / composio-session-store.ts but stay importable from here.
export { COMPOSIO_MCP_HOSTS, redactComposioMessage, type ComposioSession } from "./composio-session-contract";
export {
  composioRemoteUserId, composioSessionStorePath, readComposioSession, readComposioSessions,
  type StoredSession, type Store,
} from "./composio-session-store";

export type ComposioSessionResolution = ComposioSession & { reused: boolean; user: string };

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
