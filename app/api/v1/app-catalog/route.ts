import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { roleAtLeast } from "@/lib/auth/roles";
import { loadAppCatalog } from "@/lib/host/app-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };

export async function GET() {
  const context = await getSessionContext();
  if (!context?.session.device_id) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  if (!roleAtLeast(context.role, "owner")) return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  return NextResponse.json(await loadAppCatalog(), { headers });
}
