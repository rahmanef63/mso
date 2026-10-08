import { NextResponse } from "next/server";
import { getSessionActor } from "@/lib/auth/require-session";
import { rateLimited } from "@/lib/host/limits-api";
import { verifyAuth } from "@/lib/agent/server";
import { apiError } from "@/lib/host/request-api";
import { searchFs } from "@/lib/host/fs-api";

export const dynamic = "force-dynamic";

// GET /fs/search?q=&root= → folders matching `q` by name under `root`
// (default ~/projects). Read-only; bounded depth + result count.
export async function GET(req: Request) {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const actor = await getSessionActor();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (rateLimited(`fs.enumerate:${actor}`, 30, 60_000)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const root = url.searchParams.get("root") ?? undefined;
  try {
    return NextResponse.json(await searchFs(q, { root, signal: req.signal }));
  } catch (e) {
    return apiError("fs/search", e);
  }
}
