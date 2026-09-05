import {withIntegrationSelection} from "@/lib/infra/connection-service";
import {selectionFrom} from "@/lib/infra/connection-dispatch";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { listCloudflareZones } from "@/lib/infra";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req:NextRequest) {
  if (!(await requireSession("owner"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ zones: await withIntegrationSelection(selectionFrom(Object.fromEntries(req.nextUrl.searchParams)),()=>listCloudflareZones()) }); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 503 }); }
}
