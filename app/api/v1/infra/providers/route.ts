import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { audit } from "@/lib/host/audit-api";
import { INFRA_PROVIDER_IDS, isInfraProviderId, readInfraProvider, removeInfraProvider, setInfraProvider, summarizeInfraProvider } from "@/lib/infra";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ownerContext() {
  const context = await getSessionContext();
  return context?.role === "owner" ? context : null;
}

export async function GET() {
  if (!(await ownerContext())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const providers = await Promise.all(INFRA_PROVIDER_IDS.map(async (id) => summarizeInfraProvider(id, await readInfraProvider(id))));
  return NextResponse.json({ providers });
}

export async function POST(req: NextRequest) {
  const context = await ownerContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { id?: string; values?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  const id = String(body.id ?? "");
  if (!isInfraProviderId(id)) return NextResponse.json({ error: "unknown infrastructure provider" }, { status: 404 });
  try {
    const values = await setInfraProvider(id, body.values ?? {});
    void audit({ action: "infra.write", actor: context.session.device_id, target: id, detail: "provider.configure" });
    return NextResponse.json({ ok: true, provider: summarizeInfraProvider(id, values) });
  } catch (error) {
    void audit({ action: "infra.write", actor: context.session.device_id, target: id, ok: false, detail: `provider.configure: ${(error as Error).message}` });
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const context = await ownerContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!isInfraProviderId(id)) return NextResponse.json({ error: "unknown infrastructure provider" }, { status: 404 });
  await removeInfraProvider(id);
  void audit({ action: "infra.write", actor: context.session.device_id, target: id, detail: "provider.remove" });
  return NextResponse.json({ ok: true });
}
