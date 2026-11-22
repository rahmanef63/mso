import { json, requireOwner } from "@/lib/api/route";
import { loadAppCatalog } from "@/lib/host/app-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };

export async function GET() {
  const auth = await requireOwner({ headers });
  if (auth instanceof Response) return auth;
  return json(await loadAppCatalog(), { headers });
}
