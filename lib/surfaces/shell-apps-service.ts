import { json } from "@/lib/api/route";
import { getSessionContext } from "@/lib/auth/require-session";
import { roleAtLeast } from "@/lib/auth/roles";
import { readSetupJson } from "@/lib/infra/setup-http";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { IS_DEMO } from "@/lib/demo";
import { shellAppSettings, manageShellApp, SurfaceConfigError } from "@/lib/host/shell-apps-api";

const headers = { "Cache-Control": "no-store, private" };

export async function handleGetShellApps(request: Request): Promise<Response> {
  const context = await getSessionContext();
  if (!context?.session.device_id) return json({ error: "unauthorized" }, { status: 401, headers });
  if (!roleAtLeast(context.role, "owner")) return json({ error: "owner_required" }, { status: 403, headers });
  try {
    return json(await shellAppSettings(new URL(request.url).origin), { headers });
  } catch {
    return json({ error: "surface_registry_unavailable" }, { status: 503, headers });
  }
}

export async function handlePostShellApps(request: Request): Promise<Response> {
  const context = await getSessionContext();
  if (IS_DEMO || !context?.session.device_id || !roleAtLeast(context.role, "owner")) {
    return json({ error: "owner_required" }, { status: 403, headers });
  }
  if (rateLimited(`shell-app:${context.session.device_id}`, 20, 60_000)) {
    return json({ error: "rate_limited" }, { status: 429, headers });
  }
  try {
    const input = await readSetupJson(request);
    const result = await manageShellApp(input, new URL(request.url).origin);
    void audit({ action: "infra.write", actor: context.session.device_id, target: result.id, ok: true, detail: `shell-app.${input.action}` });
    return json(result, { headers });
  } catch (error) {
    return json(
      { error: error instanceof SurfaceConfigError ? error.message : "shell_app_update_failed" },
      { status: error instanceof SurfaceConfigError ? error.status : 400, headers },
    );
  }
}
