import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { roleAtLeast } from "@/lib/auth/roles";
import { readSetupJson } from "@/lib/infra/setup-http";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { IS_DEMO } from "@/lib/demo";
import { shellAppSettings, manageShellApp, SurfaceConfigError } from "@/lib/host/shell-apps-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
export async function GET(request: NextRequest) {
  const context = await getSessionContext();
  if (!context?.session.device_id) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  if (!roleAtLeast(context.role, "owner")) return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  try { return NextResponse.json(await shellAppSettings(request.nextUrl.origin), { headers }); }
  catch { return NextResponse.json({ error: "surface_registry_unavailable" }, { status: 503, headers }); }
}
export async function POST(request: NextRequest) {
  const context = await getSessionContext();
  if (IS_DEMO || !context?.session.device_id || !roleAtLeast(context.role, "owner")) return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  if (rateLimited(`shell-app:${context.session.device_id}`, 20, 60_000)) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers });
  try {
    const input = await readSetupJson(request);
    const result = await manageShellApp(input, request.nextUrl.origin);
    void audit({ action: "infra.write", actor: context.session.device_id, target: result.id, ok: true, detail: `shell-app.${input.action}` });
    return NextResponse.json(result, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SurfaceConfigError ? error.message : "shell_app_update_failed" }, { status: error instanceof SurfaceConfigError ? error.status : 400, headers });
  }
}
