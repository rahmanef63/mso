import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { INFRA_PROVIDER_IDS, doctorInfraProvider, isInfraProviderId } from "@/lib/infra";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!(await requireSession("owner"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { id?: string } = {};
  try { body = await req.json(); } catch { /* empty means all */ }
  const ids = body.id ? [body.id] : [...INFRA_PROVIDER_IDS];
  if (ids.some((id) => !isInfraProviderId(id))) return NextResponse.json({ error: "unknown infrastructure provider" }, { status: 404 });
  const results = await Promise.all(ids.map((id) => doctorInfraProvider(id as (typeof INFRA_PROVIDER_IDS)[number])));
  return NextResponse.json({ results });
}
