import { publicOrigin } from "@/lib/mcp/origin";
import { mcpEnabled } from "@/lib/mcp/scope";

// RFC 9728 — tells an MCP client which authorization server protects /mcp.
// This MUST be served from the same origin as the MCP URL: a client's first
// discovery probe goes to the resource host, and mirroring it anywhere else is
// what produces "MCP server does not implement OAuth" with no further detail.
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
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: ["read", "write", "exec", "offline_access"],
      bearer_methods_supported: ["header"],
    },
    { headers: { ...PUBLIC_CORS, "cache-control": "public, max-age=3600" } },
  );
}
