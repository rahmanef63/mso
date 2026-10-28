import { json } from "@/lib/api/route";
import { verifyAuth } from "@/lib/agent/server";
import { readMcpActivity } from "@/lib/mcp/activity";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await verifyAuth(req, "owner"))) return json({ error: "unauthorized" }, 401);
  const q = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 80) || 80, 1), 200);
  return json({ entries: await readMcpActivity(limit) });
}
