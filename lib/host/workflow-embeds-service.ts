import { json } from "@/lib/api/route";
import { getSessionContext } from "@/lib/auth/require-session";
import { readSetupJson } from "@/lib/infra/setup-http";
import { audit } from "@/lib/host/audit-api";
import { IS_DEMO } from "@/lib/demo";
import { rateLimited } from "@/lib/host/limits-api";
import { roleAtLeast } from "@/lib/auth/roles";
import { workflowEmbedSettings, saveWorkflowSurface, SurfaceConfigError } from "@/lib/host/workflow-embeds-api";

const headers = { "Cache-Control": "no-store, private" };

export async function handleGetWorkflowEmbeds(request: Request): Promise<Response> {
  const context = await getSessionContext();
  if (!context?.session.device_id) return json({ error: "unauthorized" }, { status: 401, headers });
  if (!roleAtLeast(context.role, "owner")) return json({ error: "owner_required" }, { status: 403, headers });
  try {
    return json(await workflowEmbedSettings(new URL(request.url).origin), { headers });
  } catch {
    return json({ error: "surface_registry_unavailable" }, { status: 503, headers });
  }
}

export async function handlePostWorkflowEmbeds(request: Request): Promise<Response> {
  const context = await getSessionContext();
  if (IS_DEMO || !context?.session.device_id || !roleAtLeast(context.role, "owner")) {
    return json({ error: "owner_required" }, { status: 403, headers });
  }
  if (rateLimited(`workflow-embed:${context.session.device_id}`, 20, 60_000)) {
    return json({ error: "rate_limited" }, { status: 429, headers });
  }
  try {
    const result = await saveWorkflowSurface(await readSetupJson(request));
    void audit({ action: "infra.write", actor: context.session.device_id, target: result.id, ok: true, detail: "workflow-embed.reviewed" });
    return json(result, { headers });
  } catch (error) {
    return json(
      { error: error instanceof SurfaceConfigError ? error.message : "surface_update_failed" },
      { status: error instanceof SurfaceConfigError ? error.status : 400, headers },
    );
  }
}
