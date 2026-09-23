import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { getBatonlyFederationWorkerStatus } from "@/lib/mcp/federation/batonly-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await verifyAuth(req, "owner"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(getBatonlyFederationWorkerStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
