import { json } from "@/lib/api/route";
import { verifyAuth } from "@/lib/agent/server";
import { listManagedApps } from "@/lib/managed-apps/manager";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await verifyAuth(req))) return json({ error: "unauthorized" }, 401);
  try {
    return json({ apps: await listManagedApps() });
  } catch {
    return json({ error: "managed applications unavailable" }, 503);
  }
}
