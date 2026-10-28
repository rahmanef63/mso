import { publicOrigin } from "@/lib/mcp/origin";
import { mcpEnabled } from "@/lib/mcp/scope";

const PUBLIC_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export async function handleOptionsAuthorizationServer(): Promise<Response> {
  return new Response(null, { status: 204, headers: PUBLIC_CORS });
}

export async function handleGetAuthorizationServer(req: Request): Promise<Response> {
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
    { headers: { ...PUBLIC_CORS, "cache-control": "no-store" } },
  );
}
