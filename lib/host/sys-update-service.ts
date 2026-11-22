import { json } from "@/lib/api/route";
import { verifyAuth } from "@/lib/agent/server";
import { apiError, readJson } from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { getUpdateStatus, startUpdate } from "@/lib/host/self-update";
import { clearAutoUpdatePause } from "@/lib/prefs/auto-update-state";
import { parseUpdateChannel } from "@/lib/prefs/updates";

// Same-origin for a mutating browser call: the request's own host or the
// installation's configured public origin. The public origin alone is wrong on a
// loopback dev/cockpit visit, where it can never match and the UI reports the
// refusal as an authorization problem.
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  // No Origin at all is not browser same-origin proof, so it stays refused. Every
  // browser sends one on a POST; this only lets non-browser callers through if it
  // were allowed, which is the opposite of what this gate is for.
  if (!origin) return false;
  const host = req.headers.get("host") ?? new URL(req.url).host;
  try {
    if (new URL(origin).host === host) return true;
  } catch {
    return false;
  }
  const configured = process.env.OS_PUBLIC_ORIGIN?.trim();
  if (!configured) return false;
  try {
    return new URL(origin).origin === new URL(configured).origin;
  } catch {
    return false;
  }
}

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
      // A browser on this host is same-origin even when OS_PUBLIC_ORIGIN names the
      // public hostname: comparing only against the configured origin rejected
      // every loopback visit with 403, which the UI then reported as "Sign in as
      // an Owner". Accept the request's own host as well, exactly like
      // /api/v1/fs/upload; the configured origin stays allowed for a proxied browse.
      if (!sameOrigin(req)) return json({ error: "same_origin_required" }, 403);
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
