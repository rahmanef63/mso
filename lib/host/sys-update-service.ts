import { json } from "@/lib/api/route";
import { verifyAuth } from "@/lib/agent/server";
import { apiError, readJson } from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { getUpdateStatus, startUpdate } from "@/lib/host/self-update";
import { clearAutoUpdatePause } from "@/lib/prefs/auto-update-state";
import { parseUpdateChannel } from "@/lib/prefs/updates";

export async function handleGetSysUpdate(req: Request): Promise<Response> {
  if (!(await verifyAuth(req))) return json({ error: "unauthorized" }, 401);
  try {
    return json(await getUpdateStatus(false));
  } catch (e) {
    return apiError("sys/update", e);
  }
}

export async function handlePostSysUpdate(req: Request): Promise<Response> {
  if (!(await verifyAuth(req))) return json({ error: "unauthorized" }, 401);
  try {
    const body = (await readJson(req).catch(() => ({}))) as { rebuildOnly?: unknown; action?: unknown; channel?: unknown };
    if (body.action === "check") {
      const origin = new URL(process.env.OS_PUBLIC_ORIGIN || req.url).origin;
      if (req.headers.get("origin") !== origin) return json({ error: "same_origin_required" }, 403);
      if (rateLimited("sys-update-check", 6, 60_000)) return json({ error: "rate_limited" }, 429);
      const status = await getUpdateStatus(true);
      audit({ action: "sys.update", target: "check", ok: true });
      return json(status);
    }
    const rebuildOnly = body.rebuildOnly === true;
    const channel = parseUpdateChannel(body.channel) ?? undefined;
    const status = await startUpdate(rebuildOnly, channel);
    await clearAutoUpdatePause();
    audit({
      action: "sys.update",
      target: rebuildOnly ? "rebuild" : `${status.target ?? "origin/main"} (+${status.behind})`,
      ok: true,
      detail: `from ${status.current} on the ${status.channel ?? "stored"} channel`,
    });
    return json(status);
  } catch (e) {
    audit({ action: "sys.update", target: "start", ok: false, detail: String(e).slice(0, 200) });
    return apiError("sys/update", e);
  }
}
