import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { apiError, rateLimited } from "@/lib/host";
import { serviceLogs } from "@/lib/host/services";
import { getSessionActor } from "@/lib/auth/require-session";
import type { ServiceScope } from "@/lib/os-api/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const actor = await getSessionActor();
  if (rateLimited(`sys-service-logs:${actor ?? "unknown"}`, 30, 60_000)) {
    return NextResponse.json({ error: "too many service log requests" }, { status: 429 });
  }
  const query = new URL(req.url).searchParams;
  try {
    return NextResponse.json(await serviceLogs(
      query.get("scope") as ServiceScope,
      query.get("unit") ?? "",
      Number(query.get("limit") ?? 120),
    ), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError("sys/services/logs", error);
  }
}
