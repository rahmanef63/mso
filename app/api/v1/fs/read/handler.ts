import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { getSessionActor } from "@/lib/auth/require-session";
import { apiError } from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { readFile } from "@/lib/host/fs-api";

// Read is the cheapest way to pull bytes off the host, and it was the one fs route with no
// ceiling: every sibling (write, delete, list, search) is rate-limited, while this one could be
// driven in a loop for a 5 MiB file each time. The window matches the other read-shaped routes;
// the cap is lower than write's 120 because a read returns content rather than an ack.
const FS_READ_MAX = 60;
const FS_READ_WINDOW_MS = 60_000;

export async function handleGetFsRead(req: Request): Promise<Response> {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const actor = await getSessionActor();
  if (rateLimited(`fs.read:${actor ?? "anon"}`, FS_READ_MAX, FS_READ_WINDOW_MS)) {
    audit({ action: "fs.read", actor, ok: false, detail: "rate-limited" });
    return NextResponse.json({ error: "Too many read requests, slow down" }, { status: 429 });
  }

  const path = new URL(req.url).searchParams.get("path") ?? "~";
  try {
    return NextResponse.json(await readFile(path));
  } catch (e) {
    return apiError("fs/read", e);
  }
}
