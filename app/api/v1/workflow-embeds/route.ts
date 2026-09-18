import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { readSetupJson } from "@/lib/infra/setup-http";
import { audit } from "@/lib/host/audit-api";
import { IS_DEMO } from "@/lib/demo";
import { rateLimited } from "@/lib/host/limits-api";
import { roleAtLeast } from "@/lib/auth/roles";
import { workflowEmbedSettings, saveWorkflowSurface, SurfaceConfigError } from "@/lib/host/workflow-embeds-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
export async function GET(request: NextRequest) {
  const context = await getSessionContext();
  if (!context?.session.device_id) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  if (!roleAtLeast(context.role, "owner")) return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  try {
    return NextResponse.json(await workflowEmbedSettings(request.nextUrl.origin), { headers });
  } catch { return NextResponse.json({ error: "surface_registry_unavailable" }, { status: 503, headers }); }
}

export async function POST(request: NextRequest) {
  const context = await getSessionContext();
  if (IS_DEMO || !context?.session.device_id || !roleAtLeast(context.role, "owner")) return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  if (rateLimited(`workflow-embed:${context.session.device_id}`, 20, 60_000)) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers });
  try {
    const result = await saveWorkflowSurface(await readSetupJson(request));
    void audit({ action: "infra.write", actor: context.session.device_id, target: result.id, ok: true, detail: "workflow-embed.reviewed" });
    return NextResponse.json(result, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SurfaceConfigError ? error.message : "surface_update_failed" }, { status: error instanceof SurfaceConfigError ? error.status : 400, headers });
  }
}
