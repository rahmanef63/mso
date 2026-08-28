import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { readMcpActivity } from "@/lib/mcp/activity";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await verifyAuth(req, "owner"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 80) || 80, 1), 200);
  return NextResponse.json({ entries: await readMcpActivity(limit) });
}
