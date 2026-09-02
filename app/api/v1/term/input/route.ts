import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { apiError, invalidRequest, readJson, requireString } from "@/lib/host/request-api";
import { writePty } from "@/lib/host/terminal-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /term/input {id,data} → raw keystrokes into the pty. Not audited and
// not command-filtered by design — see lib/host/pty.ts (owner shell; the
// auditable boundary is session open/close). No rate limit: a fast typist or
// a paste easily outruns any sane per-minute cap.
export async function POST(req: Request) {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await readJson(req);
  const id = requireString(body, "id");
  if (id === null) return invalidRequest("id");
  const data = requireString(body, "data", { allowEmpty: true });
  if (data === null) return invalidRequest("data");
  try {
    writePty(id, data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError("term/input", e);
  }
}
