import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { getSessionActor } from "@/lib/auth/require-session";
import { apiError, invalidRequest, readJson, requireString } from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { copy } from "@/lib/host/fs-api";
import { rateLimited } from "@/lib/host/limits-api";

const FS_COPY_MAX = 60;
const FS_COPY_WINDOW_MS = 60_000;

export async function handlePostFsCopy(req: Request): Promise<Response> {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const actor = await getSessionActor();
  if (rateLimited(`fs.copy:${actor ?? "anon"}`, FS_COPY_MAX, FS_COPY_WINDOW_MS)) {
    audit({ action: "fs.copy", actor, ok: false, detail: "rate-limited" });
    return NextResponse.json({ error: "Too many copy requests, slow down" }, { status: 429 });
  }
  const body = await readJson(req);
  const from = requireString(body, "from");
  if (from === null) return invalidRequest("from");
  const to = requireString(body, "to");
  if (to === null) return invalidRequest("to");
  try {
    await copy(from, to);
    audit({ action: "fs.copy", actor, target: `${from} → ${to}`, ok: true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    audit({ action: "fs.copy", actor, target: `${from} → ${to}`, ok: false, detail: String(e) });
    return apiError("fs/copy", e);
  }
}
