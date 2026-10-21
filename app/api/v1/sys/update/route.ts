import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { apiError, readJson } from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { getUpdateStatus, startUpdate } from "@/lib/host/self-update";
import { clearAutoUpdatePause } from "@/lib/prefs/auto-update-state";
import { parseUpdateChannel } from "@/lib/prefs/updates";

export const dynamic = "force-dynamic";
// Status reads and explicit update actions require the host runtime.
export const runtime = "nodejs";

// GET /sys/update → what version is running, what is on origin/main, and the log of
// the last run. Reads never fetch or modify the repository.
export async function GET(req: Request) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getUpdateStatus(false));
  } catch (e) {
    return apiError("sys/update", e);
  }
}

// POST /sys/update {rebuildOnly?, channel?} → pull, verify, build, restart. Audited:
// this replaces the code the whole cockpit runs, which is the most consequential
// thing any session can ask for. Body carries no ref and no command — the knobs are
// a boolean and the two-word channel enum; the ref is resolved server-side.
export async function POST(req: Request) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = (await readJson(req).catch(() => ({}))) as { rebuildOnly?: unknown; action?: unknown; channel?: unknown };
    if (body.action === "check") {
      const origin = new URL(process.env.OS_PUBLIC_ORIGIN || req.url).origin;
      if (req.headers.get("origin") !== origin) return NextResponse.json({ error: "same_origin_required" }, { status: 403 });
      if (rateLimited("sys-update-check", 6, 60_000)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
      const status = await getUpdateStatus(true);
      audit({ action: "sys.update", target: "check", ok: true });
      return NextResponse.json(status);
    }
    const rebuildOnly = body.rebuildOnly === true;
    // The client may name a CHANNEL, never a ref: an unknown value is ignored and the
    // stored preference decides. The ref itself is resolved server-side.
    const channel = parseUpdateChannel(body.channel) ?? undefined;
    const status = await startUpdate(rebuildOnly, channel);
    // A manual update is the operator's answer to the unattended pause. Clear the
    // failure streak when this one was accepted; otherwise the gate keeps refusing
    // forever and its own advice ("run mso update from a terminal") would be false.
    await clearAutoUpdatePause();
    audit({
      action: "sys.update",
      target: rebuildOnly ? "rebuild" : `${status.target ?? "origin/main"} (+${status.behind})`,
      ok: true,
      detail: `from ${status.current} on the ${status.channel ?? "stored"} channel`,
    });
    return NextResponse.json(status);
  } catch (e) {
    // A refusal ("already up to date", "an update is already running") is a
    // HostError → 400 via apiError, and reads as the sentence it is.
    audit({ action: "sys.update", target: "start", ok: false, detail: String(e).slice(0, 200) });
    return apiError("sys/update", e);
  }
}
