import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { apiError, readJson } from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { getUpdateStatus, startUpdate } from "@/lib/host/self-update";

export const dynamic = "force-dynamic";
// The GET runs `git fetch`, and the POST hands off to systemd-run. Neither is a
// static thing and both need the host, so this is Node, never the edge.
export const runtime = "nodejs";

// GET /sys/update → what version is running, what is on origin/main, and the log of
// the last run. `?check=0` skips the network round trip, which is what the panel
// polls with while an update is in flight.
export async function GET(req: Request) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const check = new URL(req.url).searchParams.get("check") !== "0";
    return NextResponse.json(await getUpdateStatus(check));
  } catch (e) {
    return apiError("sys/update", e);
  }
}

// POST /sys/update {rebuildOnly?} → pull, verify, build, restart. Audited: this
// replaces the code the whole cockpit runs, which is the most consequential thing
// any session can ask for. Body carries no ref and no command — the only knob is a
// boolean, and `origin/main` is hard-coded in the updater.
export async function POST(req: Request) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = (await readJson(req).catch(() => ({}))) as { rebuildOnly?: unknown };
    const rebuildOnly = body.rebuildOnly === true;
    const status = await startUpdate(rebuildOnly);
    audit({
      action: "sys.update",
      target: rebuildOnly ? "rebuild" : `origin/main (+${status.behind})`,
      ok: true,
      detail: `from ${status.current}`,
    });
    return NextResponse.json(status);
  } catch (e) {
    // A refusal ("already up to date", "an update is already running") is a
    // HostError → 400 via apiError, and reads as the sentence it is.
    audit({ action: "sys.update", target: "start", ok: false, detail: String(e).slice(0, 200) });
    return apiError("sys/update", e);
  }
}
