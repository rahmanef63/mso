/**
 * Owner-only automation surface for the Updates card.
 *
 * GET  → the pref, the REAL timer state, and the last unattended result.
 * POST → {auto?: boolean, channel?: "stable"|"main"} through the same module the
 *        CLI uses, so the browser cannot install a timer the CLI does not see.
 *
 * The route prefix `/api/v1/sys/update` is owner-only in lib/agent/server.ts, so a
 * viewer cannot schedule a host restart.
 */
import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { apiError, readJson } from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { applyAutomation, readAutomationState } from "@/lib/host/update-automation";
import { automaticUpdateReason, execRunner } from "@/lib/host/update-host-support";
import { sanitizeUpdatesPatch } from "@/lib/prefs/updates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const repoRoot = (): string => process.cwd();

export async function GET(req: Request) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const [state, reason] = await Promise.all([readAutomationState(), automaticUpdateReason(execRunner)]);
    return NextResponse.json({ ...state, supported: reason === null, reason });
  } catch (e) {
    return apiError("sys/update/automation", e);
  }
}

export async function POST(req: Request) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = (await readJson(req).catch(() => ({}))) as { updates?: unknown };
    // Strict: unknown keys and wrong types are a 400, never a silently ignored
    // "enabled" that the operator believes took effect.
    const parsed = sanitizeUpdatesPatch(body.updates);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const state = await applyAutomation(parsed.patch, { root: repoRoot() });
    audit({
      action: "sys.update",
      target: "automation",
      ok: true,
      detail: `auto=${String(state.prefs.auto)} channel=${state.prefs.channel} timer=${state.active ? "on" : "off"}`,
    });
    return NextResponse.json(state);
  } catch (e) {
    audit({ action: "sys.update", target: "automation", ok: false, detail: String(e).slice(0, 200) });
    // A refusal ("automatic updates are unavailable: …") is a HostError → 400.
    return apiError("sys/update/automation", e);
  }
}
