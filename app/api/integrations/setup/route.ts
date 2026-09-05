import { readSetupJson } from "@/lib/infra/setup-http";
import { NextRequest, NextResponse } from "next/server";
import { MSO_ORIGIN, MCP_UI_DOMAIN } from "@/lib/mcp/ui-config";
import { audit } from "@/lib/host/audit-api";
import { consumeIntegrationSetup, describeIntegrationSetup, SetupError } from "@/lib/infra/setup-capability";
import { integrationPageResponse } from "@/lib/infra/setup-page";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BASE_HEADERS = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", Vary: "Origin" };
function cors(req: NextRequest): Record<string, string> | null {
  const origin = req.headers.get("origin");
  let local = false;
  try { const url = new URL(req.url); local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && origin === url.origin; } catch { /* not a local request */ }
  if (!origin || (![MSO_ORIGIN, MCP_UI_DOMAIN].includes(origin) && !local)) return null;
  return { ...BASE_HEADERS, "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" };
}
export const GET = integrationPageResponse;
export function OPTIONS(req: NextRequest) {
  const headers = cors(req);
  return new NextResponse(null, { status: headers ? 204 : 403, headers: headers ?? BASE_HEADERS });
}
export async function POST(req: NextRequest) {
  const headers = cors(req);
  if (!headers) return NextResponse.json({ error: "origin_not_allowed" }, { status: 403, headers: BASE_HEADERS });
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.get("authorization") ?? "");
  if (!match) return NextResponse.json({ error: "setup_expired_or_invalid" }, { status: 401, headers });
  try {
    const body = await readSetupJson(req);
    if (Object.keys(body).some(k => !["action", "values"].includes(k))) throw new SetupError("invalid_request", 400);
    if (body.action === "schema") return NextResponse.json(await describeIntegrationSetup(match[1]), { headers });
    if (body.action !== "save") throw new SetupError("invalid_request", 400);
    const result = await consumeIntegrationSetup(match[1], body.values);
    void audit({ action: "infra.write", actor: result.principal, target: result.provider, ok: true, detail: "integration.secure-setup" });
    return NextResponse.json({ ok: true, verified: true, provider: result.provider }, { headers });
  } catch (error) {
    const safe = error instanceof SetupError ? error : new SetupError("setup_unavailable", 503);
    return NextResponse.json({ error: safe.code }, { status: safe.status, headers });
  }
}
