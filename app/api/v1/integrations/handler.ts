import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { liveSessionAuthorized } from "@/lib/auth/live-authorization";
import { readSetupJson } from "@/lib/infra/setup-http";
import { queryIntegrationAction, manageIntegrationAction, executeIntegrationAction } from "@/lib/infra/connection-dispatch";
import { DemoCredentialError, revealSecret } from "@/lib/infra/demo-credentials";
import { IntegrationError } from "@/lib/infra/identity";
import { audit } from "@/lib/host/audit-api";

const headers = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" };
const revealHeaders = { "Cache-Control": "private, no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer" };

function failure(e: unknown) {
  const error = e instanceof IntegrationError ? e : new IntegrationError("integration_operation_failed", 400);
  return NextResponse.json({ error: error.code }, { status: error.status, headers });
}

function revealFailure(e: unknown) {
  const error =
    e instanceof DemoCredentialError
      ? e
      : e instanceof IntegrationError
        ? new DemoCredentialError(e.code, e.status)
        : new DemoCredentialError("reveal_failed", 400);
  return NextResponse.json({ error: error.code }, { status: error.status, headers: revealHeaders });
}

export async function handleGetIntegrations(req: NextRequest): Promise<Response> {
  if ((await getSessionContext())?.role !== "owner")
    return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  try {
    return NextResponse.json(await queryIntegrationAction(Object.fromEntries(req.nextUrl.searchParams)), { headers });
  } catch (e) {
    return failure(e);
  }
}

export async function handlePostIntegrations(req: NextRequest): Promise<Response> {
  const ctx = await getSessionContext();
  if (ctx?.role !== "owner") return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  let mode = "";
  try {
    const body = await readSetupJson(req);
    mode = String(body.mode);
    const { mode: _, ...input } = body;
    if (mode === "reveal") {
      if (!ctx.session.device_id || !(await liveSessionAuthorized(ctx.session, "owner")))
        throw new DemoCredentialError("owner_required", 403);
      if (Object.keys(input).some((k) => !["provider", "user", "connection", "cwd", "demoId", "key"].includes(k)))
        throw new DemoCredentialError("invalid_reveal_fields");
      return NextResponse.json(
        await revealSecret(input, { session: ctx.session, role: ctx.role, deviceId: ctx.session.device_id }),
        { headers: revealHeaders },
      );
    }
    if (!["manage", "execute"].includes(mode)) throw new IntegrationError("invalid_action_mode");
    const result = mode === "manage" ? await manageIntegrationAction(input) : await executeIntegrationAction(input);
    void audit({
      action: "infra.write",
      actor: ctx.session.device_id,
      target: String(input.user ?? "integrations"),
      ok: true,
      detail: `integrations.${mode}`,
    });
    return NextResponse.json(result, { headers });
  } catch (e) {
    return mode === "reveal" ? revealFailure(e) : failure(e);
  }
}
