import { mcpEndpoints, type McpProbeResult } from "./mcp-client-core";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function jsonOrNull(response: Response): Promise<Record<string, unknown> | null> {
  if (!response.ok) return null;
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function headerHasResourceMetadata(response: Response, expectedUrl: string) {
  if (response.status !== 401) return false;
  const challenge = response.headers.get("www-authenticate") ?? "";
  return challenge.toLowerCase().startsWith("bearer ") && challenge.includes(`resource_metadata=\"${expectedUrl}\"`);
}

export async function probeMcpConnection(rawOrigin: string, fetcher: FetchLike = fetch): Promise<McpProbeResult> {
  const endpoints = mcpEndpoints(rawOrigin);
  const [mcpResponse, challengeResponse, resourceResponse, oauthResponse] = await Promise.all([
    fetcher(endpoints.mcp, { cache: "no-store" }).catch(() => new Response(null, { status: 599 })),
    fetcher(endpoints.mcp, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "settings-probe", method: "initialize", params: {} }),
      cache: "no-store",
    }).catch(() => new Response(null, { status: 599 })),
    fetcher(endpoints.protectedResource, { cache: "no-store" }).catch(() => new Response(null, { status: 599 })),
    fetcher(endpoints.authorizationServer, { cache: "no-store" }).catch(() => new Response(null, { status: 599 })),
  ]);

  const [mcp, resource, oauth] = await Promise.all([
    jsonOrNull(mcpResponse),
    jsonOrNull(resourceResponse),
    jsonOrNull(oauthResponse),
  ]);

  const authServers = (mcp?.authorization_servers as unknown[]) ?? [];
  const resourceAuthServers = (resource?.authorization_servers as unknown[]) ?? [];
  const pkceMethods = (oauth?.code_challenge_methods_supported as unknown[]) ?? [];
  const tokenMethods = (oauth?.token_endpoint_auth_methods_supported as unknown[]) ?? [];

  const checks: McpProbeResult["checks"] = [
    { id: "mcp", ok: mcp?.name === "mso MCP" && authServers.includes(endpoints.origin) },
    { id: "challenge", ok: headerHasResourceMetadata(challengeResponse, endpoints.protectedResource) },
    { id: "resource", ok: resource?.resource === endpoints.mcp && resourceAuthServers.includes(endpoints.origin) },
    {
      id: "oauth",
      ok:
        oauth?.issuer === endpoints.origin &&
        oauth.authorization_endpoint === endpoints.authorize &&
        oauth.token_endpoint === endpoints.token &&
        oauth.registration_endpoint === endpoints.register &&
        pkceMethods.includes("S256") &&
        tokenMethods.includes("none"),
    },
  ];
  return { ready: checks.every((check) => check.ok), checks };
}
