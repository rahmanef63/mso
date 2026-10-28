import { json } from "@/lib/api/route";
import { verifyAuth } from "@/lib/agent/server";
import { getBatonlyFederationWorkerStatus } from "@/lib/mcp/federation/batonly-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await verifyAuth(req, "owner"))) return json({ error: "unauthorized" }, 401);
  return json(getBatonlyFederationWorkerStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
