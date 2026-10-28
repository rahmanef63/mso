import { publicOrigin } from "@/lib/mcp/origin";
import { mcpEnabled } from "@/lib/mcp/scope";

const PUBLIC_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export async function handleOptionsProtectedResource(): Promise<Response> {
  return new Response(null, { status: 204, headers: PUBLIC_CORS });
}

export async function handleGetProtectedResource(req: Request): Promise<Response> {
  if (!mcpEnabled()) return new Response("Not Found", { status: 404 });
  const origin = publicOrigin(req);
  return Response.json(
    {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: ["read", "write", "exec", "offline_access"],
      bearer_methods_supported: ["header"],
    },
    { headers: { ...PUBLIC_CORS, "cache-control": "no-store" } },
  );
}
