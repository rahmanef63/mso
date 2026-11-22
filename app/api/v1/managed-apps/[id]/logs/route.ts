import { json } from "@/lib/api/route";
import { verifyAuth } from "@/lib/agent/server";
import { isManagedAppId } from "@/lib/managed-apps/catalog";
import { getManagedAppLogs } from "@/lib/managed-apps/manager";

export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await verifyAuth(req))) return json({ error: "unauthorized" }, 401);
  const { id } = await context.params;
  if (!isManagedAppId(id)) return json({ error: "unknown managed application" }, 404);
  return json(await getManagedAppLogs(id));
}
