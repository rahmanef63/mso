import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { rateLimited } from "@/lib/host/limits-api";
import { packageUpdates } from "@/lib/host/package-updates";
import { getSessionActor } from "@/lib/auth/require-session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const actor = await getSessionActor();
  if (rateLimited(`sys-package-updates:${actor ?? "unknown"}`, 10, 60_000)) {
    return NextResponse.json({ error: "too many package update checks" }, { status: 429 });
  }
  return NextResponse.json(await packageUpdates(), { headers: { "Cache-Control": "no-store" } });
}
