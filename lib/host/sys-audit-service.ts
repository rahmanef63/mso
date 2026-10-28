import { json } from "@/lib/api/route";
import { verifyAuth } from "@/lib/agent/server";
import { readAuditTail } from "@/lib/host/audit-api";

export async function handleSysAudit(req: Request): Promise<Response> {
  if (!(await verifyAuth(req))) return json({ error: "unauthorized" }, 401);
  const q = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 50) || 50, 1), 200);
  const prefix = q.get("prefix") ?? undefined;
  const actor = q.get("actor") ?? undefined;
  const entries = await readAuditTail({ prefix, limit: actor ? 200 : limit });
  return json({
    entries: (actor ? entries.filter((e) => (e.actor ?? "").startsWith(actor)) : entries).slice(0, limit),
  });
}
