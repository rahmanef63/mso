import { normalizeMcpEndpoint } from "./mcp-policy";
import { obj } from "./http";
import { COMPOSIO_API_BASE, COMPOSIO_CONNECT_KEY_MESSAGE } from "./composio";
import { IntegrationError } from "./identity";

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
export const SESSION_URL = `${COMPOSIO_API_BASE}/tool_router/session`;
/** Same allowlist as Composio redirect links, plus the host the spec example returns. */
export const COMPOSIO_MCP_HOSTS = ["connect.composio.dev", "backend.composio.dev", "platform.composio.dev", "app.composio.dev"];
const MAX_HEADERS = 32;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;

export type ComposioSession = {
  sessionId: string;
  mcpUrl: string;
  /** The credential the SDK exports for this session URL: composed from the key that authenticated the create call. Server-side only. */
  mcpHeaders: Record<string, string>;
  expiresAt?: number;
};

/** One helper for every message this module throws: an upstream body can echo a credential. */
export function redactComposioMessage(message: string, secrets: (string | undefined)[]): string {
  let out = message;
  for (const secret of secrets) if (secret && secret.length >= 6) out = out.split(secret).join("[redacted]");
  return out;
}

export function connectKeyRefusal(): IntegrationError {
  const error = new IntegrationError("composio_connect_key_wrong_provider", 409);
  error.message = COMPOSIO_CONNECT_KEY_MESSAGE;
  return error;
}

export function headerMap(value: unknown): Record<string, string> {
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
export function composioMcpUrl(raw: string): string {
  let href: string;
  try { href = normalizeMcpEndpoint(raw); } catch { throw new IntegrationError("invalid_composio_mcp_endpoint", 502); }
  if (!COMPOSIO_MCP_HOSTS.includes(new URL(href).hostname)) throw new IntegrationError("invalid_composio_mcp_host", 502);
  return href;
}
