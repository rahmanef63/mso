import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { readAuditTail } from "@/lib/host/audit-api";

// The audit trail, read-only. Session-gated like every other /api/v1 route.
//
// There is deliberately NO MCP tool for this. The trail records what every MCP
// token did; letting a token read it would let a compromised one check whether it
// had been noticed, and edit nothing but its own expectations. Forensics is a
// surface for the owner in a browser, not for an agent.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 50) || 50, 1), 200);
  const prefix = q.get("prefix") ?? undefined;
  const actor = q.get("actor") ?? undefined;
  const entries = await readAuditTail({ prefix, limit: actor ? 200 : limit });
  return NextResponse.json({
    entries: (actor ? entries.filter((e) => (e.actor ?? "").startsWith(actor)) : entries).slice(0, limit),
  });
}
