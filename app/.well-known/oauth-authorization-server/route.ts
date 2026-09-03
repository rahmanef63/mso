import { publicOrigin } from "@/lib/mcp/origin";
import { mcpEnabled } from "@/lib/mcp/scope";

// RFC 8414 — authorization-server metadata. Public clients only (no secret),
// PKCE S256 only; authorization_code + rotating refresh_token grants. Dynamic Client Registration is
// advertised because Claude.ai, Cursor and mcp-remote all expect it; ChatGPT
// uses a user-defined client and never touches /oauth/register.
export const runtime = "nodejs";

const PUBLIC_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: PUBLIC_CORS });
}

export async function GET(req: Request) {
  if (!mcpEnabled()) return new Response("Not Found", { status: 404 });
  const origin = publicOrigin(req);
  return Response.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["read", "write", "exec", "offline_access"],
      authorization_response_iss_parameter_supported: true,
    },
    { headers: { ...PUBLIC_CORS, "cache-control": "public, max-age=3600" } },
  );
}
