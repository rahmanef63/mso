import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { camoufoxStatus, setCamoufoxEnabled } from "@/lib/camoufox/service";
import { apiError, readJson } from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Power for the Camoufox display, so the Browser app's on/off switch reaches the
// host instead of only hiding a window. Two actions, no unit name from the client —
// the module owns the unit, this route owns the gate.

// GET /camoufox/service → {running, enabled, installed}
export async function GET(req: Request) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await camoufoxStatus());
  } catch (e) {
    return apiError("camoufox/service", e);
  }
}

// POST /camoufox/service {action:"start"|"stop"} → the status AFTER the change.
export async function POST(req: Request) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Each start forks systemctl and boots a browser on an X display. This route had
  // no limit at all, which was survivable while the only caller was a toggle in the
  // UI and stopped being so when an MCP bearer could reach it. Same shape and
  // number as the managed-app bucket, which is the same kind of operation.
  if (rateLimited("camoufox", 12, 60_000)) {
    return NextResponse.json({ error: "too many operations" }, { status: 429 });
  }
  try {
    const { action } = (await readJson(req)) as { action?: unknown };
    if (action !== "start" && action !== "stop") {
      return NextResponse.json({ error: "action must be 'start' or 'stop'" }, { status: 400 });
    }

    const status = await setCamoufoxEnabled(action === "start");
    audit({
      action: "camoufox.power",
      target: "camoufox-vnc.service",
      // Trust the unit's own post-state, not the request: `enable --now` can exit 0
      // on a unit whose ExecStart then dies (a missing VNC password file is exactly
      // that case), and logging the intent would record a start that never happened.
      ok: status.running === (action === "start"),
      detail: action,
    });
    return NextResponse.json(status);
  } catch (e) {
    return apiError("camoufox/service", e);
  }
}
