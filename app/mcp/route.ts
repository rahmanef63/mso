import { dispatch, isNotification, rpcError, UNAUTHORIZED, RATE_LIMITED, type RpcRequest } from "@/lib/mcp/dispatch";
import { getClient, validateToken, touchToken } from "@/lib/mcp/store";
import { clampScope, mcpEnabled } from "@/lib/mcp/scope";
import { publicOrigin, clientIp, mcpRequestOriginAllowed } from "@/lib/mcp/origin";
import { rateLimited, rateLimitedUntrusted } from "@/lib/host";
import { TOOLS } from "@/lib/mcp/tools";
import { toolsetInfo } from "@/lib/mcp/toolset";
import { detectMcpToolProfile } from "@/lib/mcp/client-profile";
import { supportedMcpProtocol } from "@/lib/mcp/protocol";
import { visibleToolsForProfile } from "@/lib/mcp/tool-contract";
import { mcpSessionHeaders, resolveMcpSession } from "@/lib/mcp/session-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CALLS_PER_MIN = 120;
const CALLS_PER_DAY = 50_000;
const PREAUTH_PER_MIN = 240;
export const MAX_MCP_BODY_BYTES = 2 * 1024 * 1024;
class BodyTooLarge extends Error {}

async function parseBoundedJson(req: Request): Promise<unknown> {
  const rawLength = req.headers.get("content-length");
  if (rawLength) {
    const length = Number(rawLength);
    if (Number.isFinite(length) && length > MAX_MCP_BODY_BYTES) throw new BodyTooLarge();
  }
  if (!req.body) return JSON.parse("");
  const reader = req.body.getReader(), decoder = new TextDecoder();
  let total = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > MAX_MCP_BODY_BYTES) {
        await reader.cancel("MCP request body too large").catch(() => {}); throw new BodyTooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode(); return JSON.parse(text);
  } finally { reader.releaseLock(); }
}

export async function POST(req: Request) {
  const origin = publicOrigin(req);
  const challenge = `Bearer realm="mso", resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
  const unauthorized = (msg: string) => Response.json(rpcError(null, UNAUTHORIZED, msg), { status: 401, headers: { "WWW-Authenticate": challenge } });
  if (!mcpEnabled()) return new Response("Not Found", { status: 404 });
  if (!mcpRequestOriginAllowed(req)) return Response.json({ error: "forbidden_origin" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (rateLimitedUntrusted(`mcp:ip:${clientIp(req)}`, PREAUTH_PER_MIN, 60_000)) {
    return Response.json(rpcError(null, RATE_LIMITED, "rate limited"), { status: 429, headers: { "Retry-After": "60" } });
  }

  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return unauthorized("missing bearer token");
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
  try { body = await parseBoundedJson(req); }
  catch (error) {
    if (error instanceof BodyTooLarge) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "request body too large" } }, { status: 413, headers: { "Cache-Control": "no-store" } });
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { status: 400 });
  }

  const rpc = body as RpcRequest;
  const protocolHeader = (req.headers.get("mcp-protocol-version") ?? "").trim();
  if (rpc.method !== "initialize" && protocolHeader && !supportedMcpProtocol(protocolHeader)) {
    return Response.json({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code: -32600, message: "unsupported MCP-Protocol-Version" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const principal = token.clientId ? `mcp-client:${token.clientId}` : `mcp-token:${token.hash}`;
  const expectedResource = `${origin}/mcp`;
  if (token.resource && token.resource !== expectedResource) return unauthorized("token was minted for a different MCP resource");
  const client = token.clientId ? await getClient(token.clientId).catch(() => null) : null;
  const toolProfile = token.profile ?? client?.profile ?? detectMcpToolProfile({ clientId: token.clientId, name: client?.name, redirectUris: client?.redirectUris });
  const resolved = await resolveMcpSession(req, rpc, principal, token.label);
  if ("response" in resolved) return resolved.response;
  const headers = mcpSessionHeaders(resolved.responseSessionId);
  if (isNotification(body)) return new Response(null, { status: 202, headers });

  void touchToken(token.hash).catch(() => {});
  const actor = `mcp:${token.hash.slice(0, 16)}`;
  const agentContext = { principal, ...(resolved.agentSessionId ? { sessionId: resolved.agentSessionId } : {}), toolProfile };
  const result = await dispatch(rpc, effectiveScope, actor, agentContext);
  return Response.json(result, { status: 200, headers });
}

export async function GET(req: Request) {
  if (!mcpEnabled()) return new Response("Not Found", { status: 404 });
  if (!mcpRequestOriginAllowed(req)) return Response.json({ error: "forbidden_origin" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  // Streamable HTTP: a client GET is an optional SSE listener. MSO does not need
  // one for its bounded request/response model, so the standards-compliant answer
  // is 405 rather than a JSON diagnostics document masquerading as SSE.
  if ((req.headers.get("accept") ?? "").toLowerCase().includes("text/event-stream")) {
    return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
  }
  const full = toolsetInfo(TOOLS, undefined, "full");
  const chatgptTools = visibleToolsForProfile(TOOLS, "exec", "chatgpt");
  return Response.json({
    name: "mso MCP", transport: "streamable-http", auth: "OAuth 2.1 + PKCE + resource binding",
    sessions: "ChatGPT conversations bind through hashed _meta[openai/session]; Mcp-Session-Id is legacy transport compatibility only",
    authorization_servers: [publicOrigin(req)], toolset: full, chatgptToolset: toolsetInfo(chatgptTools, "exec", "chatgpt"),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST, GET", "Cache-Control": "no-store" } });
}
