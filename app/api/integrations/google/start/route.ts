import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { beginGoogleAuthorization } from "@/lib/infra/google-oauth-flow";
import { googlePublicOrigin, isGoogleProvider } from "@/lib/infra/google-native-config";
import { identity, IntegrationError, metadataOnly } from "@/lib/infra/identity";
import { readSetupJson } from "@/lib/infra/setup-http";
import { audit } from "@/lib/host/audit-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
export async function POST(req: NextRequest) {
  const ctx = await getSessionContext();
  if (ctx?.role !== "owner" || !ctx.session.device_id) return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  try {
    const origin = googlePublicOrigin();
    if (req.headers.get("origin") !== origin || req.headers.get("host")?.toLowerCase() !== new URL(origin).host) throw new IntegrationError("google_same_origin_required", 403);
    const body = await readSetupJson(req); metadataOnly(body);
    if (Object.keys(body).some(k => !["user", "provider", "connection"].includes(k)) || !isGoogleProvider(String(body.provider))) throw new IntegrationError("invalid_google_request");
    const user = identity(body.user, "user"), connection = identity(body.connection, "connection"), provider = String(body.provider);
    if (!isGoogleProvider(provider)) throw new IntegrationError("invalid_google_request");
    const flow = await beginGoogleAuthorization(provider, { user, connection }, { deviceId: ctx.session.device_id, cookieScope: ctx.session.cookie_scope, cookieEpoch: ctx.session.cookie_epoch, sessionExpiresAt: ctx.session.expires_at });
    const response = NextResponse.json({ authorizationUrl: flow.authorizationUrl, expiresIn: flow.expiresIn }, { headers });
    response.cookies.set(flow.cookieName, flow.binding, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: flow.expiresIn });
    void audit({ action: "infra.write", actor: ctx.session.device_id, target: `${user}/${provider}/${connection}`, ok: true, detail: "google.authorization.start" });
    return response;
  } catch (error) { return NextResponse.json({ error: error instanceof IntegrationError ? error.code : "google_authorization_start_failed" }, { status: error instanceof IntegrationError ? error.status : 400, headers }); }
}
