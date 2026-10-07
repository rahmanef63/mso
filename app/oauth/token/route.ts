import { readRequestJson, readRequestText, RequestBodyError } from "@/lib/security/request-body";
import { TenantDenied } from "@/lib/tenancy/authority";
import { consumeCode, OAUTH_ACCESS_TOKEN_TTL_MS, rotateOAuthGrant, storeOAuthGrant } from "@/lib/mcp/store";
import { verifyPkce, randomToken } from "@/lib/mcp/pkce";
import { mcpEnabled, oauthScopeString } from "@/lib/mcp/scope";
import { clientIp, publicOrigin } from "@/lib/mcp/origin";
import { rateLimitedUntrusted } from "@/lib/host/limits-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });

async function params(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type")?.split(";")[0].trim();
  if (ct === "application/json") {
    const body = await readRequestJson(req, 16 * 1024);
    if (Object.values(body).some(value => typeof value !== "string")) throw new RequestBodyError(400, "invalid_request");
    return body as Record<string, string>;
  }
  if (ct !== "application/x-www-form-urlencoded") throw new RequestBodyError(415, "unsupported_content_type");
  return Object.fromEntries(new URLSearchParams(await readRequestText(req, 16 * 1024)));
}

export async function POST(req: Request) {
  if (!mcpEnabled()) return new Response("Not Found", { status: 404 });
  if (rateLimitedUntrusted(`mcp:token:${clientIp(req)}`, 30, 60_000)) return json({ error: "rate_limited" }, 429);
  let p: Record<string, string>;
  try { p = await params(req); } catch (error) { return json({ error: "invalid_request" }, error instanceof RequestBodyError ? error.status : 400); }
  const expectedResource = `${publicOrigin(req)}/mcp`;

  if (p.grant_type === "refresh_token") {
    if (!p.refresh_token || !p.client_id) return json({ error: "invalid_request" }, 400);
    const resource = p.resource || expectedResource;
    if (resource !== expectedResource) return json({ error: "invalid_target" }, 400);
    const access = randomToken("mso_mcp_"), refresh = randomToken("mso_refresh_");
    const rec = await rotateOAuthGrant({ oldRefreshToken: p.refresh_token, accessToken: access, refreshToken: refresh, label: `oauth · ${p.client_id.slice(0, 14)}`, clientId: p.client_id, resource });
    if (!rec) return json({ error: "invalid_grant" }, 400);
    return json({ access_token: access, token_type: "Bearer", refresh_token: refresh, expires_in: Math.floor(OAUTH_ACCESS_TOKEN_TTL_MS / 1000), scope: oauthScopeString(rec.scope, rec.offlineAccess === true) });
  }

  if (p.grant_type !== "authorization_code") return json({ error: "unsupported_grant_type" }, 400);
  if (!p.code || !p.code_verifier || !p.client_id || !p.redirect_uri) return json({ error: "invalid_request" }, 400);
  const rec = await consumeCode(p.code);
  if (!rec) return json({ error: "invalid_grant" }, 400);
  const resource = p.resource || rec.resource || expectedResource;
  if (rec.clientId !== p.client_id || rec.redirectUri !== p.redirect_uri || resource !== (rec.resource || expectedResource) || resource !== expectedResource) return json({ error: "invalid_grant" }, 400);
  if (!verifyPkce(p.code_verifier, rec.codeChallenge, "S256")) return json({ error: "invalid_grant" }, 400);

  const access = randomToken("mso_mcp_"), refresh = randomToken("mso_refresh_"), grantId = randomToken("grant_", 16);
  try { await storeOAuthGrant({ accessToken: access, refreshToken: refresh, label: `oauth · ${rec.clientId.slice(0, 14)}`, clientId: rec.clientId, scope: rec.scope, resource, profile: rec.profile, offlineAccess: rec.offlineAccess, grantId, tenantBinding: rec.tenantBinding }); }
  catch (error) { if (error instanceof TenantDenied) return json({ error: "invalid_grant" }, 400); throw error; }
  return json({ access_token: access, token_type: "Bearer", refresh_token: refresh, expires_in: Math.floor(OAUTH_ACCESS_TOKEN_TTL_MS / 1000), scope: oauthScopeString(rec.scope, rec.offlineAccess === true) });
}
