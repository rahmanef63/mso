import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { getSessionActor } from "@/lib/auth/require-session";
import { apiError, invalidRequest, optionalString, readJson, requireInt } from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { openPty } from "@/lib/host/terminal-api";
import { rateLimited } from "@/lib/host/limits-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Open guard: each session is a real shell process; 20/min is plenty for a
// human (the session cap in pty.ts bounds the steady state).
const OPEN_MAX = 20;
const OPEN_WINDOW_MS = 60_000;

// POST /term/open {cols,rows,cwd?} → {id}. Spawns the owner's interactive
// login shell (see lib/host/pty.ts for why no command filter applies here).
export async function POST(req: Request) {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const actor = await getSessionActor();
  if (rateLimited(`term:${actor ?? "anon"}`, OPEN_MAX, OPEN_WINDOW_MS)) {
    audit({ action: "term.open", actor, ok: false, detail: "rate-limited" });
    return NextResponse.json({ error: "Too many terminal sessions, slow down" }, { status: 429 });
  }

  const body = await readJson(req);
  const cols = requireInt(body, "cols", 2, 500);
  if (cols === null) return invalidRequest("cols");
  const rows = requireInt(body, "rows", 2, 500);
  if (rows === null) return invalidRequest("rows");
  const cwd = optionalString(body, "cwd");
  if (cwd === null) return invalidRequest("cwd");
  try {
    const { id, cwd: dir } = await openPty({ cols, rows, cwd });
    audit({
      action: "term.open",
      actor,
      target: dir,
      ok: true,
      detail: `pty ${id.slice(0, 8)} ${cols}x${rows}`,
    });
    return NextResponse.json({ id });
  } catch (e) {
    audit({ action: "term.open", actor, ok: false, detail: String(e) });
    return apiError("term/open", e);
  }
}
