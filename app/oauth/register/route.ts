import { registerClient } from "@/lib/mcp/store";
import { isAllowedRedirect } from "@/lib/mcp/pkce";
import { mcpEnabled } from "@/lib/mcp/scope";
import { clientIp } from "@/lib/mcp/origin";
import { rateLimitedUntrusted } from "@/lib/host";

// RFC 7591 Dynamic Client Registration. Open by design and safe to be: a
// registered client is INERT until the owner approves it on the consent page and
// completes PKCE. All this records is a name and a redirect list.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DCR_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const bad = (error: string, description: string, status = 400) =>
  Response.json({ error, error_description: description }, { status, headers: { ...DCR_CORS, "Cache-Control": "no-store" } });

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: DCR_CORS });
}

export async function POST(req: Request) {
  if (!mcpEnabled()) return new Response("Not Found", { status: 404 });
  if (rateLimitedUntrusted(`mcp:dcr:${clientIp(req)}`, 10, 3_600_000)) {
    return Response.json({ error: "rate_limited" }, { status: 429, headers: { ...DCR_CORS, "Retry-After": "3600" } });
  }

  let body: { redirect_uris?: unknown; client_name?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("invalid_request", "body must be JSON");
  }

  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
    return bad("invalid_redirect_uri", "redirect_uris is required and must be a non-empty array");
  }
  const uris = [...new Set(body.redirect_uris.map(String).filter(isAllowedRedirect))];
  // Say WHICH rule was broken. A generic 400 here is why DCR failures are so hard
  // to debug from the client side — the client cannot see the server's reasoning.
  if (uris.length === 0) return bad("invalid_redirect_uri", "at least one https (or localhost) redirect_uri is required");
  if (uris.length > 8) return bad("invalid_client_metadata", "at most 8 redirect_uris");

  const name = typeof body.client_name === "string" ? body.client_name : "MCP Client";
  const clientId = await registerClient(name, uris);
  return Response.json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: uris,
      client_name: name.slice(0, 80),
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201, headers: { ...DCR_CORS, "Cache-Control": "no-store" } },
  );
}
