import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { rateLimited } from "@/lib/host/limits-api";
import { audit } from "@/lib/host/audit-api";
import { readRequestJson, RequestBodyError } from "@/lib/security/request-body";
import { IntegrationError } from "@/lib/infra/identity";
import { currentIntegrationSelection } from "@/lib/infra/connection-service";
import { readInfraProvider } from "@/lib/infra/store";
import { composioKeyKind } from "@/lib/infra/composio";
import { composioSessionForUser } from "@/lib/infra/composio-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

/**
 * Key kind only, never a key: the browser needs to know whether to offer the agent
 * session action (Platform key) or the Project MCP guidance (ck_ Connect key).
 */
export async function GET() {
  const context = await getSessionContext();
  if (context?.role !== "owner") return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  try {
    return NextResponse.json({ keyKind: composioKeyKind(await readInfraProvider("composio")) }, { headers });
  } catch {
    return NextResponse.json({ keyKind: null }, { headers });
  }
}

/**
 * POST creates-or-reuses the Composio session for the CURRENT credential owner.
 * The owner comes from the server-side selection (session context / folder binding),
 * never from the body. Response carries only the MCP URL and expiry: `mcp.headers`
 * is the session credential and must stay server-side.
 */
export async function POST(req: NextRequest) {
  const context = await getSessionContext();
  if (context?.role !== "owner") return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  if (rateLimited(`composio.session:${context.session.device_id ?? "unknown"}`, 10, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers });
  }
  try {
    // Body is optional and may only ask for a refresh; identity and key material stay server-owned.
    const input = req.body && req.headers.get("content-length") !== "0" ? await readRequestJson(req, 4096) : {};
    if (Object.keys(input).some((key) => key !== "refresh")) throw new IntegrationError("invalid_session_fields", 400);
    const values = await readInfraProvider("composio");
    const session = await composioSessionForUser({
      values,
      user: currentIntegrationSelection().user,
      refresh: input.refresh === true,
    });
    void audit({ action: "infra.write", actor: context.session.device_id, target: "composio", ok: true, detail: `composio.session.${session.reused ? "reuse" : "create"}` });
    return NextResponse.json({
      mcpUrl: session.mcpUrl,
      ...(session.expiresAt !== undefined ? { expiresAt: session.expiresAt } : {}),
    }, { headers });
  } catch (error) {
    const safe = error instanceof IntegrationError || error instanceof RequestBodyError ? error : new IntegrationError("composio_session_failed", 502);
    return NextResponse.json({ error: safe.message }, { status: safe.status, headers });
  }
}
