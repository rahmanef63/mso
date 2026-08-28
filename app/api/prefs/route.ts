import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { readPrefs, writePrefs, type OsPrefs } from "@/lib/prefs/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cross-device prefs sync (appearance tweaks + quicklinks). GET → stored prefs;
// POST → partial section merge. Session-gated; mirrors /api/config exactly.

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
  let body: { tweaks?: Record<string, unknown>; quicklinks?: unknown };
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
  if (!patch.tweaks && !patch.quicklinks) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  await writePrefs(patch);
  return NextResponse.json({ ok: true });
}
