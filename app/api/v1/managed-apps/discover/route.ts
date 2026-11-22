import { json } from "@/lib/api/route";
import { getSessionContext } from "@/lib/auth/require-session";
import { roleAtLeast } from "@/lib/auth/roles";
import { rateLimited } from "@/lib/host/limits-api";
import { discoverLocalApps } from "@/lib/managed-apps/local-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, private" };

export async function GET() {
  const context = await getSessionContext();
  if (!context?.session.device_id) return json({ error: "unauthorized" }, { status: 401, headers });
  if (!roleAtLeast(context.role, "owner")) return json({ error: "owner_required" }, { status: 403, headers });
  if (rateLimited(`mapp-discover:${context.session.device_id}`, 30, 60_000)) {
    return json({ error: "rate_limited" }, { status: 429, headers });
  }
  try {
    return json(await discoverLocalApps(), { headers });
  } catch {
    return json({ error: "local_discovery_unavailable" }, { status: 503, headers });
  }
}
