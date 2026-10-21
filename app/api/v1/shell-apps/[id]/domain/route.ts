import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { roleAtLeast } from "@/lib/auth/roles";
import { IS_DEMO } from "@/lib/demo";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { readSetupJson } from "@/lib/infra/setup-http";
import { AppDomainError, ensureShellAppDomain, inspectShellAppDomain, type DomainProviderId } from "@/lib/surfaces/app-domain-provision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
type Context = { params: Promise<{ id: string }> };

/** Gate order is shared by both verbs: session -> owner -> demo -> rate limit -> lib -> audit. */
async function gate(request: NextRequest, scope: string, limit: number) {
  const context = await getSessionContext();
  if (!context?.session.device_id) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401, headers }) };
  if (!roleAtLeast(context.role, "owner")) return { error: NextResponse.json({ error: "owner_required" }, { status: 403, headers }) };
  if (IS_DEMO) return { error: NextResponse.json({ error: "owner_required" }, { status: 403, headers }) };
  if (rateLimited(`${scope}:${context.session.device_id}`, limit, 60_000)) return { error: NextResponse.json({ error: "rate_limited" }, { status: 429, headers }) };
  return { context, request };
}
function failure(error: unknown) {
  if (error instanceof AppDomainError) return NextResponse.json({ error: error.code }, { status: error.status, headers });
  // SetupError-style body/parse rejections keep their own bounded code and status.
  const bounded = error as { code?: unknown; status?: unknown };
  if (typeof bounded?.code === "string" && bounded.code.length <= 64 && typeof bounded.status === "number" && bounded.status >= 400 && bounded.status < 500) {
    return NextResponse.json({ error: bounded.code }, { status: bounded.status, headers });
  }
  return NextResponse.json({ error: "provider_unavailable" }, { status: 503, headers });
}

export async function GET(request: NextRequest, context: Context) {
  const allowed = await gate(request, "shell-app-domain-read", 60);
  if (allowed.error) return allowed.error;
  const { id } = await context.params;
  try { return NextResponse.json(await inspectShellAppDomain(id), { headers }); }
  catch (error) { return failure(error); }
}

export async function POST(request: NextRequest, context: Context) {
  const allowed = await gate(request, "shell-app-domain", 10);
  if (allowed.error) return allowed.error;
  const actor = allowed.context.session.device_id!, { id } = await context.params;
  try {
    const body = await readSetupJson(request, 8 * 1024);
    const record = await ensureShellAppDomain(id, {
      provider: body.provider as DomainProviderId,
      hostname: String(body.hostname ?? ""),
      target: body.target as never,
      ...(body.zoneName === undefined ? {} : { zoneName: String(body.zoneName) }),
    });
    void audit({ action: "infra.write", actor, target: id, ok: record.phase !== "blocked",
      detail: `shell-app.domain.${record.phase}`, meta: { hostname: record.hostname, provider: String(record.provider) } });
    return NextResponse.json(record, { headers });
  } catch (error) {
    const code = error instanceof AppDomainError ? error.code : (error as { code?: unknown })?.code;
    void audit({ action: "infra.write", actor, target: id, ok: false, detail: `shell-app.domain.${typeof code === "string" ? code : "failed"}` });
    return failure(error);
  }
}
