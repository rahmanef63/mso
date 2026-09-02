import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { getSessionActor } from "@/lib/auth/require-session";
import { apiError, invalidRequest, readJson, requireString } from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { writeFile } from "@/lib/host/fs-api";

export const dynamic = "force-dynamic";

// Burst guard (same limiter as /exec/run); per-actor, per-op bucket.
const FS_WRITE_MAX = 120;
const FS_WRITE_WINDOW_MS = 60_000;

// os-rr POST /fs/write {path,content} → write within WRITE roots.
export async function POST(req: Request) {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const actor = await getSessionActor();
  if (rateLimited(`fs.write:${actor ?? "anon"}`, FS_WRITE_MAX, FS_WRITE_WINDOW_MS)) {
    audit({ action: "fs.write", actor, ok: false, detail: "rate-limited" });
    return NextResponse.json({ error: "Too many write requests, slow down" }, { status: 429 });
  }
  const body = await readJson(req);
  const path = requireString(body, "path");
  if (path === null) return invalidRequest("path");
  const content = requireString(body, "content", { allowEmpty: true });
  if (content === null) return invalidRequest("content");
  try {
    await writeFile(path, content);
    audit({ action: "fs.write", actor, target: path, ok: true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    audit({ action: "fs.write", actor, target: path, ok: false, detail: String(e) });
    return apiError("fs/write", e);
  }
}
