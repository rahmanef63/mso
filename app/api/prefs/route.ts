import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { readPrefs, writePrefs, type OsPrefs } from "@/lib/prefs/store";
import { sanitizeUpdatesPatch } from "@/lib/prefs/updates";
import { applyAutomation } from "@/lib/host/update-automation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cross-device prefs sync (appearance tweaks + quicklinks + update automation).
// GET → stored prefs; POST → partial section merge. Session-gated; mirrors
// /api/config exactly.

export async function GET() {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await readPrefs());
}

export async function POST(req: NextRequest) {
  // These preferences are shared across every approved device, not personal to
  // the caller. Delegated devices may consume them, but only Owner may mutate them.
  if (!(await requireSession("owner"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { tweaks?: Record<string, unknown>; quicklinks?: unknown; updates?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const patch: Partial<OsPrefs> = {};
  if (body.tweaks && typeof body.tweaks === "object" && !Array.isArray(body.tweaks)) {
    // wallpaperStyle is computed from wallpaperImage on the client — never store it.
    const { wallpaperStyle: _computed, ...rest } = body.tweaks;
    patch.tweaks = rest as OsPrefs["tweaks"];
  }
  if (Array.isArray(body.quicklinks)) {
    patch.quicklinks = body.quicklinks as OsPrefs["quicklinks"];
  }
  // `updates` is the one section that is not just a file write: enabling it must
  // install the timer. It goes through the same authority as the CLI and the
  // Settings toggle, so a POST here can never leave `auto:true` with no unit.
  let updates: ReturnType<typeof sanitizeUpdatesPatch> | null = null;
  if (body.updates !== undefined) {
    updates = sanitizeUpdatesPatch(body.updates);
    if (!updates.ok) return NextResponse.json({ error: updates.error }, { status: 400 });
  }
  if (!patch.tweaks && !patch.quicklinks && !updates) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  // Automation FIRST: enabling it can be refused by the host, and a refusal must not
  // leave the appearance section half-applied. It writes its own section through the
  // same serialized store, so the two writes cannot clobber each other.
  if (updates?.ok) {
    try {
      await applyAutomation(updates.patch, { root: process.cwd() });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "could not apply update automation";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }
  if (patch.tweaks || patch.quicklinks) await writePrefs(patch);
  return NextResponse.json({ ok: true });
}
