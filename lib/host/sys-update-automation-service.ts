import { json } from "@/lib/api/route";
import { verifyAuth } from "@/lib/agent/server";
import { apiError, readJson } from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { applyAutomation, readAutomationState } from "@/lib/host/update-automation";
import { automaticUpdateReason, execRunner } from "@/lib/host/update-host-support";
import { sanitizeUpdatesPatch } from "@/lib/prefs/updates";

const repoRoot = (): string => process.cwd();

export async function handleGetSysUpdateAutomation(req: Request): Promise<Response> {
  if (!(await verifyAuth(req))) return json({ error: "unauthorized" }, 401);
  try {
    const [state, reason] = await Promise.all([readAutomationState(), automaticUpdateReason(execRunner)]);
    return json({ ...state, supported: reason === null, reason });
  } catch (e) {
    return apiError("sys/update/automation", e);
  }
}

export async function handlePostSysUpdateAutomation(req: Request): Promise<Response> {
  if (!(await verifyAuth(req))) return json({ error: "unauthorized" }, 401);
  try {
    const body = (await readJson(req).catch(() => ({}))) as { updates?: unknown };
    const parsed = sanitizeUpdatesPatch(body.updates);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const state = await applyAutomation(parsed.patch, { root: repoRoot() });
    audit({
      action: "sys.update",
      target: "automation",
      ok: true,
      detail: `auto=${String(state.prefs.auto)} channel=${state.prefs.channel} timer=${state.active ? "on" : "off"}`,
    });
    return json(state);
  } catch (e) {
    audit({ action: "sys.update", target: "automation", ok: false, detail: String(e).slice(0, 200) });
    return apiError("sys/update/automation", e);
  }
}
