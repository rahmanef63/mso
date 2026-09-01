import { dispatch, isNotification, rpcError, UNAUTHORIZED, RATE_LIMITED, type RpcRequest } from "@/lib/mcp/dispatch";
import { validateToken, touchToken } from "@/lib/mcp/store";
import { clampScope, mcpEnabled } from "@/lib/mcp/scope";
import { publicOrigin, clientIp, mcpRequestOriginAllowed } from "@/lib/mcp/origin";
import { rateLimited, rateLimitedUntrusted } from "@/lib/host";
import { TOOLS } from "@/lib/mcp/tools";
import { toolsetInfo } from "@/lib/mcp/toolset";
import { createAgentSession, getAgentSession } from "@/lib/agent/session-store";

// The MCP endpoint. Deliberately at /mcp and NOT under /api: proxy.ts blocks
// mutating /api that cannot prove same-origin, and an MCP client is by definition
// cross-origin. The CSRF gate is not what protects this route — the bearer is, and
// a bearer is not something a browser attaches on its own the way a cookie is.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CALLS_PER_MIN = 120;
const CALLS_PER_DAY = 50_000;
const PREAUTH_PER_MIN = 240;
const MCP_SESSION_HEADER = "Mcp-Session-Id";
export const MAX_MCP_BODY_BYTES = 2 * 1024 * 1024;

class BodyTooLarge extends Error {}

async function parseBoundedJson(req: Request): Promise<unknown> {
  const rawLength = req.headers.get("content-length");
  if (rawLength) {
    const length = Number(rawLength);
    if (Number.isFinite(length) && length > MAX_MCP_BODY_BYTES) throw new BodyTooLarge();
  }

  if (!req.body) return JSON.parse("");
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_MCP_BODY_BYTES) {
        await reader.cancel("MCP request body too large").catch(() => {});
        throw new BodyTooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
}

async function resolveAgentSession(
  req: Request,
  body: RpcRequest,
  principal: string,
  label: string,
): Promise<{ sessionId: string } | { response: Response }> {
  try {
    if (body.method === "initialize") {
      const session = await createAgentSession(principal, "mcp", { title: `ChatGPT/MCP · ${label || "MSO"}` });
      return { sessionId: session.id };
    }
    const sessionId = (req.headers.get(MCP_SESSION_HEADER) ?? "").trim();
    if (!sessionId) {
      return {
        response: Response.json(
          { jsonrpc: "2.0", id: body.id ?? null, error: { code: -32600, message: "missing MCP session id; initialize the connection again" } },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        ),
      };
    }
    const session = await getAgentSession(principal, sessionId);
    if (!session || session.source !== "mcp") {
      return {
        response: Response.json(
          { jsonrpc: "2.0", id: body.id ?? null, error: { code: -32600, message: "unknown MCP session id for this client" } },
          { status: 404, headers: { "Cache-Control": "no-store" } },
        ),
      };
    }
    return { sessionId };
  } catch {
    return {
      response: Response.json(
        { jsonrpc: "2.0", id: body.id ?? null, error: { code: -32603, message: "could not establish MSO agent session" } },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
}

export async function POST(req: Request) {
  const origin = publicOrigin(req);
  const challenge = `Bearer realm="mso", resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
  const unauthorized = (msg: string) =>
    Response.json(rpcError(null, UNAUTHORIZED, msg), { status: 401, headers: { "WWW-Authenticate": challenge } });

  if (!mcpEnabled()) return new Response("Not Found", { status: 404 });
  if (!mcpRequestOriginAllowed(req)) {
    return Response.json({ error: "forbidden_origin" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  // Pre-auth flood guard: an invalid token still costs a sha256 + a file read.
  if (rateLimitedUntrusted(`mcp:ip:${clientIp(req)}`, PREAUTH_PER_MIN, 60_000)) {
    return Response.json(rpcError(null, RATE_LIMITED, "rate limited"), { status: 429, headers: { "Retry-After": "60" } });
  }

  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return unauthorized("missing bearer token");

  // Authenticate before reading any caller-controlled body. A rejected bearer must
  // cost only the bounded token lookup, never a multi-megabyte JSON allocation.
  const token = await validateToken(bearer);
  if (!token) return unauthorized("invalid, revoked or expired MCP token");
  const effectiveScope = clampScope(token.scope);

  if (rateLimited(`mcp:tok:${token.hash}`, CALLS_PER_MIN, 60_000)) {
    return Response.json(rpcError(null, RATE_LIMITED, "rate limited — retry in 60s"), { status: 429, headers: { "Retry-After": "60" } });
  }
  if (rateLimited(`mcp:day:${token.hash}`, CALLS_PER_DAY, 86_400_000)) {
    return Response.json(rpcError(null, RATE_LIMITED, "daily call limit reached for this token"), { status: 429, headers: { "Retry-After": "3600" } });
  }

  let body: unknown;
  try {
    body = await parseBoundedJson(req);
  } catch (error) {
    if (error instanceof BodyTooLarge) {
      return Response.json(
        { jsonrpc: "2.0", id: null, error: { code: -32600, message: "request body too large" } },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { status: 400 });
  }

  const rpc = body as RpcRequest;
  const principal = `mcp-client:${token.clientId}`;
  const resolved = await resolveAgentSession(req, rpc, principal, token.label);
  if ("response" in resolved) return resolved.response;
  const sessionHeaders = { "Cache-Control": "no-store", [MCP_SESSION_HEADER]: resolved.sessionId };

  // Ack EVERY authenticated notification, not just notifications/initialized — a
  // client that sends notifications/cancelled hangs waiting for a response otherwise.
  if (isNotification(body)) return new Response(null, { status: 202, headers: sessionHeaders });

  void touchToken(token.hash).catch(() => {});
  // Audit actor remains token-specific, while agent principal is client-specific so
  // a refreshed bearer can resume the same client's sessions without weakening audit identity.
  const actor = `mcp:${token.hash.slice(0, 16)}`;
  const result = await dispatch(rpc, effectiveScope, actor, { principal, sessionId: resolved.sessionId });
  return Response.json(result, { status: 200, headers: sessionHeaders });
}

// Some clients probe with GET before POSTing. Answer with what this is, never
// with anything that needs the token.
export async function GET(req: Request) {
  if (!mcpEnabled()) return new Response("Not Found", { status: 404 });
  if (!mcpRequestOriginAllowed(req)) {
    return Response.json({ error: "forbidden_origin" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({
    name: "mso MCP",
    transport: "streamable-http (JSON-RPC over POST)",
    auth: "Bearer <mcp token> — obtain via OAuth 2.1 + PKCE",
    sessions: "durable Mcp-Session-Id; use agent_sessions_list / agent_session_resume across ChatGPT conversations",
    authorization_servers: [publicOrigin(req)],
    toolset: toolsetInfo(TOOLS),
  });
}
