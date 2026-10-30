import { withIntegrationSelection, projectProviderQuery } from "@/lib/infra/connection-service";
import { selectionFrom } from "@/lib/infra/connection-dispatch";
import { projectKey } from "@/lib/infra/convex-project-link";
import { rateLimited } from "@/lib/host/limits-api";
import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { audit } from "@/lib/host/audit-api";
import { INFRA_PROVIDER_IDS, isInfraProviderId, readInfraProvider, removeInfraProvider, setInfraProvider, summarizeInfraProvider } from "@/lib/infra";


// Per-project view: cloud and self-hosted rows together, credentials never included.

const headers = { "Cache-Control": "no-store, private", "Pragma": "no-cache", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

async function ownerContext() {
  const context = await getSessionContext();
  return context?.role === "owner" ? context : null;
}

export async function handleGetInfraProviders(req: NextRequest): Promise<Response> {
  const context = await ownerContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  if (rateLimited(`infra.providers:${context.session.device_id ?? "unknown"}`, 60, 60_000))
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers });
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const query = params.project;
  if (query !== undefined) {
    let project: string;
    try { project = projectKey(query); } catch { return NextResponse.json({ error: "invalid_project_id" }, { status: 400, headers }); }
    const view = await withIntegrationSelection(selectionFrom(params), () => projectProviderQuery({ project, selector: selectionFrom(params) }));
    return NextResponse.json(view, { headers });
  }
  const providers = await withIntegrationSelection(selectionFrom(params), () => Promise.all(INFRA_PROVIDER_IDS.map(async (id) => summarizeInfraProvider(id, await readInfraProvider(id)))));
  return NextResponse.json({ providers }, { headers });
}

export async function handlePostInfraProviders(req: NextRequest): Promise<Response> {
  const context = await ownerContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { id?: string; user?: string; connection?: string; cwd?: string; values?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  const id = String(body.id ?? "");
  if (!isInfraProviderId(id)) return NextResponse.json({ error: "unknown infrastructure provider" }, { status: 404 });
  try {
    const values = await withIntegrationSelection(selectionFrom(body), () => setInfraProvider(id, body.values ?? {}));
    void audit({ action: "infra.write", actor: context.session.device_id, target: id, detail: "provider.configure" });
    return NextResponse.json({ ok: true, provider: summarizeInfraProvider(id, values) });
  } catch (error) {
    void audit({ action: "infra.write", actor: context.session.device_id, target: id, ok: false, detail: `provider.configure: ${(error as Error).message}` });
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function handleDeleteInfraProviders(req: NextRequest): Promise<Response> {
  const context = await ownerContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!isInfraProviderId(id)) return NextResponse.json({ error: "unknown infrastructure provider" }, { status: 404 });
  await withIntegrationSelection(selectionFrom(Object.fromEntries(req.nextUrl.searchParams)), () => removeInfraProvider(id));
  void audit({ action: "infra.write", actor: context.session.device_id, target: id, detail: "provider.remove" });
  return NextResponse.json({ ok: true });
}
