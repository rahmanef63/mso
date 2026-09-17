import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { getSessionActor } from "@/lib/auth/require-session";
import { apiError, invalidRequest, readJson, requireString } from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { closePty } from "@/lib/host/terminal-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /term/close {id} → kill the shell. Idempotent: closing an unknown or
// already-exited session is ok (the client fires this on unmount regardless),
// and only an actual kill is audited.
export async function POST(req: Request) {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const actor = await getSessionActor();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJson(req);
  const id = requireString(body, "id");
  if (id === null) return invalidRequest("id");
  try {
    const killed = closePty(id, actor);
    if (killed) {
      audit({ action: "term.close", actor, target: `pty ${id.slice(0, 8)}`, ok: true });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError("term/close", e);
  }
}
