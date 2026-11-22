import { json } from "@/lib/api/route";
import { verifyAuth } from "@/lib/agent/server";

export const dynamic = "force-dynamic";

// os-rr GET /apps → host-managed runtime apps. None yet (the app registry lives
// client-side in localStorage); resolve to empty so OsApi.apps.list is a no-op.
export async function GET(req: Request) {
  if (!(await verifyAuth(req))) return json({ error: "unauthorized" }, 401);
  return json([]);
}
