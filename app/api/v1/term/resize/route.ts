import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { apiError, invalidRequest, readJson, requireInt, requireString } from "@/lib/host/request-api";
import { resizePty } from "@/lib/host/terminal-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /term/resize {id,cols,rows} → SIGWINCH the pty to the new geometry.
export async function POST(req: Request) {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await readJson(req);
  const id = requireString(body, "id");
  if (id === null) return invalidRequest("id");
  const cols = requireInt(body, "cols", 2, 500);
  if (cols === null) return invalidRequest("cols");
  const rows = requireInt(body, "rows", 2, 500);
  if (rows === null) return invalidRequest("rows");
  try {
    resizePty(id, cols, rows);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError("term/resize", e);
  }
}
