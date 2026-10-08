import { NextResponse } from "next/server";
import { getSessionActor } from "@/lib/auth/require-session";
import { rateLimited } from "@/lib/host/limits-api";
import { verifyAuth } from "@/lib/agent/server";
import { apiError } from "@/lib/host/request-api";
import { listDir } from "@/lib/host/fs-api";

export const dynamic = "force-dynamic";

// os-rr GET /fs/list?path= → local host listing (hidden files included).
export async function GET(req: Request) {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const actor = await getSessionActor();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (rateLimited(`fs.enumerate:${actor}`, 30, 60_000)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const path = new URL(req.url).searchParams.get("path") ?? "~";
  try {
    return NextResponse.json(await listDir(path, true, req.signal));
  } catch (e) {
    return apiError("fs/list", e);
  }
}
