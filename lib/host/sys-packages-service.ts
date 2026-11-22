import { json } from "@/lib/api/route";
import { verifyAuth } from "@/lib/agent/server";
import { rateLimited } from "@/lib/host/limits-api";
import { packageUpdates } from "@/lib/host/package-updates";
import { getSessionActor } from "@/lib/auth/require-session";

export async function handleGetSysPackages(req: Request): Promise<Response> {
  if (!(await verifyAuth(req))) return json({ error: "unauthorized" }, 401);
  const actor = await getSessionActor();
  if (rateLimited(`sys-package-updates:${actor ?? "unknown"}`, 10, 60_000)) {
    return json({ error: "too many package update checks" }, 429);
  }
  return json(await packageUpdates(), { headers: { "Cache-Control": "no-store" } });
}
