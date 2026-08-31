import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { listCloudflareZones } from "@/lib/infra";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireSession("owner"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ zones: await listCloudflareZones() }); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 503 }); }
}
