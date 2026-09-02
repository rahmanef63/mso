import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { apiError } from "@/lib/host/request-api";
import { searchFs } from "@/lib/host/fs-api";

export const dynamic = "force-dynamic";

// GET /fs/search?q=&root= → folders matching `q` by name under `root`
// (default ~/projects). Read-only; bounded depth + result count.
export async function GET(req: Request) {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const root = url.searchParams.get("root") ?? undefined;
  try {
    return NextResponse.json(await searchFs(q, { root }));
  } catch (e) {
    return apiError("fs/search", e);
  }
}
