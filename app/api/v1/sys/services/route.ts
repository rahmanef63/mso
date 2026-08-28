import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { apiError, audit, rateLimited } from "@/lib/host";
import { listSystemServices, servicePower } from "@/lib/host/services";
import { getSessionActor } from "@/lib/auth/require-session";
import type { ServiceAction, ServiceScope } from "@/lib/os-api/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const actor = await getSessionActor();
  if (rateLimited(`sys-services-list:${actor ?? "unknown"}`, 30, 60_000)) {
    return NextResponse.json({ error: "too many service inventory requests" }, { status: 429 });
  }
  try {
    return NextResponse.json(await listSystemServices(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError("sys/services", error);
  }
}

export async function POST(req: Request) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { scope?: ServiceScope; unit?: string; action?: ServiceAction };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid request body" }, { status: 400 }); }
  const actor = await getSessionActor();
  if (rateLimited(`sys-service-action:${actor ?? "unknown"}`, 12, 60_000)) {
    return NextResponse.json({ error: "too many service actions" }, { status: 429 });
  }
  try {
    const service = await servicePower(body.scope as ServiceScope, body.unit as string, body.action as ServiceAction);
    await audit({
      action: "sys.service",
      actor,
      target: `${service.scope}:${service.unit}`,
      detail: body.action,
    });
    return NextResponse.json(service, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await audit({
      action: "sys.service",
      actor,
      target: `${body.scope ?? "?"}:${body.unit ?? "?"}`,
      detail: error instanceof Error ? error.message : String(error),
      ok: false,
    });
    return apiError("sys/services", error);
  }
}
