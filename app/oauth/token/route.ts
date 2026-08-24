import { consumeCode, storeToken, TOKEN_TTL_MS } from "@/lib/mcp/store";
import { verifyPkce, randomToken } from "@/lib/mcp/pkce";
import { mcpEnabled } from "@/lib/mcp/scope";
import { clientIp } from "@/lib/mcp/origin";
import { rateLimitedUntrusted } from "@/lib/host";

// OAuth token endpoint. authorization_code only, PKCE mandatory.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });

export async function POST(req: Request) {
  if (!mcpEnabled()) return new Response("Not Found", { status: 404 });
  if (rateLimitedUntrusted(`mcp:token:${clientIp(req)}`, 30, 60_000)) {
    return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  // ChatGPT posts form-encoded; some clients post JSON. Accept both.
  const p: Record<string, string> = {};
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    Object.assign(p, await req.json().catch(() => ({})));
  } else {
    const form = await req.formData().catch(() => null);
    if (form) for (const [k, v] of form.entries()) p[k] = String(v);
  }

  if (p.grant_type !== "authorization_code") return json({ error: "unsupported_grant_type" }, 400);
  if (!p.code || !p.code_verifier || !p.client_id || !p.redirect_uri) return json({ error: "invalid_request" }, 400);

  // Consume FIRST: the row is gone before anything is minted, so a replay (or two
  // racing retries) finds nothing and gets invalid_grant rather than a second token.
  const rec = await consumeCode(p.code);
  // Every failure below is the same opaque invalid_grant — telling a caller which
  // check failed tells an attacker which half of the guess was right.
  if (!rec) return json({ error: "invalid_grant" }, 400);
  if (rec.clientId !== p.client_id || rec.redirectUri !== p.redirect_uri) return json({ error: "invalid_grant" }, 400);
  if (!verifyPkce(p.code_verifier, rec.codeChallenge, "S256")) return json({ error: "invalid_grant" }, 400);

  const token = randomToken("mso_mcp_");
  await storeToken(token, {
    label: `oauth · ${rec.clientId.slice(0, 14)}`,
    clientId: rec.clientId,
    scope: rec.scope,
  });
  return json(
    { access_token: token, token_type: "Bearer", scope: rec.scope, expires_in: Math.floor(TOKEN_TTL_MS / 1000) },
    200,
  );
}
