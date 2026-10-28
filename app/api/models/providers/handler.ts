import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { listProviderSummaries, providerSummariesFromCatalog } from "@/lib/models/discovery.js";

export async function handleGetProviders(req: NextRequest): Promise<Response> {
  if (!(await requireSession("owner"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const freeOnly = req.nextUrl.searchParams.get("free") === "1";
  try {
    return NextResponse.json({ providers: await listProviderSummaries({ freeOnly }) });
  } catch {
    // Keep every endpoint-pinned provider connectable even on a cold offline box,
    // but advertise no free models without catalog pricing evidence.
    return NextResponse.json({ providers: providerSummariesFromCatalog({}, { freeOnly }) });
  }
}
