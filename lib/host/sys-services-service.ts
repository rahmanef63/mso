import { json } from "@/lib/api/route";
import { verifyAuth } from "@/lib/agent/server";
import { apiError } from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { listSystemServices, serviceLogs, servicePower } from "@/lib/host/services";
import { getSessionActor } from "@/lib/auth/require-session";
import type { ServiceAction, ServiceScope } from "@/lib/os-api/types";
import { readRequestJson, RequestBodyError } from "@/lib/security/request-body";

export async function handleGetSysServices(req: Request): Promise<Response> {
  if (!(await verifyAuth(req))) return json({ error: "unauthorized" }, 401);
  const actor = await getSessionActor();
  if (rateLimited(`sys-services-list:${actor ?? "unknown"}`, 30, 60_000)) {
    return json({ error: "too many service inventory requests" }, 429);
  }
  try {
    return json(await listSystemServices(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError("sys/services", error);
  }
}

export async function handlePostSysServices(req: Request): Promise<Response> {
  if (!(await verifyAuth(req))) return json({ error: "unauthorized" }, 401);
  const actor = await getSessionActor();
  if (rateLimited(`sys-service-action:${actor ?? "unknown"}`, 12, 60_000)) {
    return json({ error: "too many service actions" }, 429);
  }
  let body: { scope?: ServiceScope; unit?: string; action?: ServiceAction };
  try {
    body = await readRequestJson(req, 4096);
  } catch (error) {
    return json(
      { error: "invalid request body" },
      error instanceof RequestBodyError ? error.status : 400,
    );
  }
  try {
    const service = await servicePower(body.scope as ServiceScope, body.unit as string, body.action as ServiceAction);
    await audit({
      action: "sys.service",
      actor,
      target: `${service.scope}:${service.unit}`,
      detail: body.action,
    });
    return json(service, { headers: { "Cache-Control": "no-store" } });
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

export async function handleGetSysServiceLogs(req: Request): Promise<Response> {
  if (!(await verifyAuth(req))) return json({ error: "unauthorized" }, 401);
  const actor = await getSessionActor();
  if (rateLimited(`sys-service-logs:${actor ?? "unknown"}`, 30, 60_000)) {
    return json({ error: "too many service log requests" }, 429);
  }
  const query = new URL(req.url).searchParams;
  try {
    return json(
      await serviceLogs(
        query.get("scope") as ServiceScope,
        query.get("unit") ?? "",
        Number(query.get("limit") ?? 120),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError("sys/services/logs", error);
  }
}
