import { dispatch, isNotification, rpcError, UNAUTHORIZED, RATE_LIMITED } from "@/lib/mcp/dispatch";
import { validateToken, touchToken } from "@/lib/mcp/store";
import { mcpEnabled } from "@/lib/mcp/scope";
import { publicOrigin, clientIp } from "@/lib/mcp/origin";
import { rateLimited, rateLimitedUntrusted } from "@/lib/host";
import { TOOLS } from "@/lib/mcp/tools";
import { toolsetInfo } from "@/lib/mcp/toolset";

// The MCP endpoint. Deliberately at /mcp and NOT under /api: proxy.ts blocks
// mutating /api that cannot prove same-origin, and an MCP client is by definition
// cross-origin. The CSRF gate is not what protects this route — the bearer is, and
// a bearer is not something a browser attaches on its own the way a cookie is.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CALLS_PER_MIN = 120;
const CALLS_PER_DAY = 5_000;
const PREAUTH_PER_MIN = 240;

export async function POST(req: Request) {
  const origin = publicOrigin(req);
  const challenge = `Bearer realm="mso", resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
  const unauthorized = (msg: string) =>
    Response.json(rpcError(null, UNAUTHORIZED, msg), { status: 401, headers: { "WWW-Authenticate": challenge } });

  if (!mcpEnabled()) return new Response("Not Found", { status: 404 });

  // Pre-auth flood guard: an invalid token still costs a sha256 + a file read.
  if (rateLimitedUntrusted(`mcp:ip:${clientIp(req)}`, PREAUTH_PER_MIN, 60_000)) {
    return Response.json(rpcError(null, RATE_LIMITED, "rate limited"), { status: 429, headers: { "Retry-After": "60" } });
  }

  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return unauthorized("missing bearer token");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { status: 400 });
  }

  // Ack EVERY notification, not just notifications/initialized — a client that
  // sends notifications/cancelled hangs waiting for a response it will never get.
  if (isNotification(body)) return new Response(null, { status: 202 });

  const token = await validateToken(bearer);
  if (!token) return unauthorized("invalid, revoked or expired MCP token");

  if (rateLimited(`mcp:tok:${token.hash}`, CALLS_PER_MIN, 60_000)) {
    return Response.json(rpcError(null, RATE_LIMITED, "rate limited — retry in 60s"), { status: 429, headers: { "Retry-After": "60" } });
  }
  // Per-minute alone still allows ~172k calls/day from one runaway agent, on an
  // endpoint whose top scope is a shell. The daily cap is the backstop.
  if (rateLimited(`mcp:day:${token.hash}`, CALLS_PER_DAY, 86_400_000)) {
    return Response.json(rpcError(null, RATE_LIMITED, "daily call limit reached for this token"), { status: 429, headers: { "Retry-After": "3600" } });
  }

  void touchToken(token.hash).catch(() => {});
  // Same 16-char id the Settings table and `mso mcp list` show, so an audit line
  // maps straight back to the token you would revoke.
  const result = await dispatch(body as Parameters<typeof dispatch>[0], token.scope, `mcp:${token.hash.slice(0, 16)}`);
  return Response.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
}

// Some clients probe with GET before POSTing. Answer with what this is, never
// with anything that needs the token.
export async function GET(req: Request) {
  if (!mcpEnabled()) return new Response("Not Found", { status: 404 });
  return Response.json({
    name: "mso MCP",
    transport: "streamable-http (JSON-RPC over POST)",
    auth: "Bearer <mcp token> — obtain via OAuth 2.1 + PKCE",
    authorization_servers: [publicOrigin(req)],
    toolset: toolsetInfo(TOOLS),
  });
}
