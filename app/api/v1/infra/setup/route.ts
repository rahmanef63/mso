import { MSO_ORIGIN } from "@/lib/mcp/ui-config";
import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { audit } from "@/lib/host/audit-api";
import { openIntegrationSetup } from "@/lib/infra/setup-capability";
import { readSetupJson } from "@/lib/infra/setup-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const context = await getSessionContext();
  const headers = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" };
  if (context?.role !== "owner" || !context.session.device_id) return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  try {
    const body = await readSetupJson(req);
    if (Object.keys(body).some(k => !["provider", "method"].includes(k)) || typeof body.provider !== "string" || (body.method !== undefined && typeof body.method !== "string")) throw new Error("invalid");
    const grant = await openIntegrationSetup(body.provider, context.session.device_id, body.method as string | undefined);
    void audit({ action: "infra.write", actor: context.session.device_id, target: body.provider, ok: true, detail: "integration.setup-open" });
    return NextResponse.json({ ...grant, setupUrl: `${MSO_ORIGIN}/integrations` }, { headers });
  } catch { return NextResponse.json({ error: "setup_unavailable" }, { status: 400, headers }); }
}
