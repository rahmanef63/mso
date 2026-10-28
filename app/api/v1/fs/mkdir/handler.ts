import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { getSessionActor } from "@/lib/auth/require-session";
import { apiError, invalidRequest, readJson, requireString } from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { makeDir } from "@/lib/host/fs-api";
import { rateLimited } from "@/lib/host/limits-api";

const FS_MKDIR_MAX = 120;
const FS_MKDIR_WINDOW_MS = 60_000;

export async function handlePostFsMkdir(req: Request): Promise<Response> {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const actor = await getSessionActor();
  if (rateLimited(`fs.mkdir:${actor ?? "anon"}`, FS_MKDIR_MAX, FS_MKDIR_WINDOW_MS)) {
    audit({ action: "fs.mkdir", actor, ok: false, detail: "rate-limited" });
    return NextResponse.json({ error: "Too many mkdir requests, slow down" }, { status: 429 });
  }
  const body = await readJson(req);
  const path = requireString(body, "path");
  if (path === null) return invalidRequest("path");
  try {
    await makeDir(path);
    audit({ action: "fs.mkdir", actor, target: path, ok: true });
    return NextResponse.json({ kind: "dir" });
  } catch (e) {
    audit({ action: "fs.mkdir", actor, target: path, ok: false, detail: String(e) });
    return apiError("fs/mkdir", e);
  }
}
