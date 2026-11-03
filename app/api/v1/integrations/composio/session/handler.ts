import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { rateLimited } from "@/lib/host/limits-api";
import { audit } from "@/lib/host/audit-api";
import { readRequestJson, RequestBodyError } from "@/lib/security/request-body";
import { IntegrationError } from "@/lib/infra/identity";
import { readIntegrationState } from "@/lib/infra/connection-storage";
import { identity, selectConnection, resolveSharedConnection } from "@/lib/infra/identity";
import { composioKeyKind } from "@/lib/infra/composio";
import { composioConnectionScope, composioSessionForUser } from "@/lib/infra/composio-session";

const headers = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

async function selection(user: unknown, connection: unknown) {
  const state = await readIntegrationState();
  const selected = selectConnection(state, "composio", { user: identity(user, "user"), connection: identity(connection, "connection") });
  if (selected.connection.source !== "direct") throw new IntegrationError("external_source_requires_own_executor", 409);
  const backing = resolveSharedConnection(state, selected.user, selected.connection).connection;
  return { user: selected.user, values: backing.values, scope: composioConnectionScope(selected.connection.uid, backing.revision, backing.values) };
}

export async function handleGetComposioSession(req: NextRequest): Promise<Response> {
  const context = await getSessionContext();
  if (context?.role !== "owner") return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  try {
    const selected = await selection(req.nextUrl.searchParams.get("user"), req.nextUrl.searchParams.get("connection"));
    return NextResponse.json({ keyKind: composioKeyKind(selected.values) }, { headers });
  } catch (error) {
    const safe = error instanceof IntegrationError ? error : new IntegrationError("composio_session_failed", 502);
    return NextResponse.json({ error: safe.message }, { status: safe.status, headers });
  }
}

export async function handlePostComposioSession(req: NextRequest): Promise<Response> {
  const context = await getSessionContext();
  if (context?.role !== "owner") return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  if (rateLimited(`composio.session:${context.session.device_id ?? "unknown"}`, 10, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers });
  }
  try {
    const input = req.body && req.headers.get("content-length") !== "0" ? await readRequestJson(req, 4096) : {};
    if (Object.keys(input).some((key) => !["refresh", "user", "connection"].includes(key))) throw new IntegrationError("invalid_session_fields", 400);
    const selected = await selection(input.user, input.connection);
    const session = await composioSessionForUser({
      values: selected.values,
      user: selected.user,
      cacheScope: selected.scope,
      refresh: input.refresh === true,
    });
    void audit({
      action: "infra.write",
      actor: context.session.device_id,
      target: "composio",
      ok: true,
      detail: `composio.session.${session.reused ? "reuse" : "create"}`,
    });
    return NextResponse.json(
      {
        mcpUrl: session.mcpUrl,
        ...(session.expiresAt !== undefined ? { expiresAt: session.expiresAt } : {}),
      },
      { headers },
    );
  } catch (error) {
    const safe =
      error instanceof IntegrationError || error instanceof RequestBodyError
        ? error
        : new IntegrationError("composio_session_failed", 502);
    return NextResponse.json({ error: safe.message }, { status: safe.status, headers });
  }
}
