import { json } from "@/lib/api/route";
import { clientMessage, errorMessage } from "@/lib/host/error-message";
import { isOrganizationFlowAction } from "@/lib/contracts/organization-flow";
import { getSessionContext } from "@/lib/auth/require-session";
import { roleAtLeast } from "@/lib/auth/roles";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { readSetupJson } from "@/lib/infra/setup-http";
import {
  deleteOrganizationSeat,
  deleteOrganizationUnit,
  mutateOrganizationFlow,
  getOrganizationChart,
  replaceOrganization,
  upsertOrganizationSeat,
  upsertOrganizationUnit,
} from "@/lib/agent/organization-store";
import { organizationRuntime, resolveOrganizationSeat } from "@/lib/agent/organization-runtime";

const headers = { "Cache-Control": "private, no-store" };

// `fail` is called two ways in this file: with a caught error, and with a literal code the
// route chose ("operator_required", "owner_required"). Keeping them on separate paths is what
// stops a propagated string from reaching a response body — see lib/host/error-message.ts.
const fail = (error: unknown, status = 400) =>
  json({ error: errorMessage(error) }, { status, headers });

const failCode = (code: string, status = 400) =>
  json({ error: clientMessage(code) }, { status, headers });

async function auth(minimum: "viewer" | "operator" | "owner" = "viewer") {
  const context = await getSessionContext();
  if (!context?.session.device_id || !roleAtLeast(context.role, minimum)) return null;
  return { context, principal: `web:${context.session.device_id}` };
}

export async function getOrganizationResponse(req: Request): Promise<Response> {
  const session = await auth("viewer");
  if (!session) return failCode("unauthorized", 401);
  try {
    const chart = await getOrganizationChart();
    const url = new URL(req.url);
    const seatRef = url.searchParams.get("seat");
    if (seatRef) {
      return json(
        {
          chart: { name: chart.name, revision: chart.revision },
          seat: await resolveOrganizationSeat(seatRef),
          runtime: await organizationRuntime(session.principal),
        },
        { headers },
      );
    }
    return json(
      {
        chart,
        runtime: url.searchParams.get("runtime") === "0" ? [] : await organizationRuntime(session.principal),
      },
      { headers },
    );
  } catch (error) {
    return fail(error);
  }
}

export async function handleOrganizationAction(req: Request): Promise<Response> {
  const session = await auth("operator");
  if (!session) return failCode("operator_required", 403);
  try {
    const body = await readSetupJson(req, 2 * 1024 * 1024);
    const action = String(body.action || "");
    if (rateLimited(`organization:${action}:${session.context.session.device_id}`, 40, 60_000)) {
      return failCode("rate_limited", 429);
    }
    const revision = String(body.expected_revision || "");
    if (!revision) throw new Error("expected_revision is required");
    let chart;
    if (action === "unit_upsert") {
      chart = await upsertOrganizationUnit(revision, body.unit as Record<string, unknown>);
    } else if (action === "seat_upsert") {
      chart = await upsertOrganizationSeat(revision, body.seat as Record<string, unknown>, session.context.role === "owner" ? "exec" : "write");
    } else if (action === "unit_delete") {
      chart = await deleteOrganizationUnit(revision, String(body.id || ""));
    } else if (action === "seat_delete") {
      chart = await deleteOrganizationSeat(revision, String(body.id || ""));
    } else if (isOrganizationFlowAction(action)) {
      chart = await mutateOrganizationFlow(revision, action, (body.data ?? {}) as Record<string, unknown>, { principal: session.principal });
    } else if (action === "replace") {
      if (!roleAtLeast(session.context.role, "owner")) return failCode("owner_required", 403);
      chart = await replaceOrganization(revision, body.chart as never, "exec");
    } else {
      throw new Error("unknown organization action");
    }
    void audit({ action: "agent.organization", actor: session.context.session.device_id, target: action, detail: `organization ${action}` });
    return json({ chart, runtime: await organizationRuntime(session.principal) }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return fail(error, /revision changed/.test(message) ? 409 : 400);
  }
}
