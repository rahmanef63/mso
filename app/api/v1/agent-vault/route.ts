import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { getAgentVault, syncAgentVault } from "@/lib/host/agent-vault-api";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { readSetupJson } from "@/lib/infra/setup-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const failure = (error: unknown, status = 400) => NextResponse.json({ error: error instanceof Error ? error.message.slice(0, 300) : "Vault request failed" }, { status, headers });
export async function GET(req: NextRequest) {
  const context = await getSessionContext();
  if (!context) return failure(new Error("unauthorized"), 401);
  if (context.role !== "owner") return failure(new Error("owner_required"), 403);
  if (rateLimited(`agent-vault:read:${context.session.device_id}`, 60, 60_000)) return failure(new Error("rate_limited"), 429);
  try { return NextResponse.json(await getAgentVault(req.nextUrl.searchParams.get("project") ?? undefined, req.nextUrl.searchParams.get("note") ?? undefined), { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(req: NextRequest) {
  const context = await getSessionContext();
  if (!context) return failure(new Error("unauthorized"), 401);
  if (context.role !== "owner") return failure(new Error("owner_required"), 403);
  if (rateLimited(`agent-vault:sync:${context.session.device_id}`, 10, 60_000)) return failure(new Error("rate_limited"), 429);
  try {
    const body = await readSetupJson(req, 4096);
    if (body.project !== undefined && typeof body.project !== "string") throw new Error("project must be a string");
    const result = await syncAgentVault(body.project as string | undefined);
    void audit({ action: "fs.write", actor: context.session.device_id, target: result.state.root, detail: "Refresh repository agent vault" });
    return NextResponse.json(result, { headers });
  } catch (error) { return failure(error); }
}
