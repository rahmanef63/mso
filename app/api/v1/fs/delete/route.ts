import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { getSessionActor } from "@/lib/auth/require-session";
import { apiError, invalidRequest, readJson, requireString } from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { remove } from "@/lib/host/fs-api";

export const dynamic = "force-dynamic";

// Burst guard (same limiter as /exec/run); per-actor, per-op bucket. Destructive op → tighter cap.
const FS_DELETE_MAX = 60;
const FS_DELETE_WINDOW_MS = 60_000;

// os-rr DELETE /fs/delete {path} → recursive remove within WRITE roots.
export async function DELETE(req: Request) {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const actor = await getSessionActor();
  if (rateLimited(`fs.delete:${actor ?? "anon"}`, FS_DELETE_MAX, FS_DELETE_WINDOW_MS)) {
    audit({ action: "fs.delete", actor, ok: false, detail: "rate-limited" });
    return NextResponse.json({ error: "Too many delete requests, slow down" }, { status: 429 });
  }
  const body = await readJson(req);
  const path = requireString(body, "path");
  if (path === null) return invalidRequest("path");
  try {
    await remove(path);
    audit({ action: "fs.delete", actor, target: path, ok: true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    audit({ action: "fs.delete", actor, target: path, ok: false, detail: String(e) });
    return apiError("fs/delete", e);
  }
}
