import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { getAgentVault, syncAgentVault } from "@/lib/host/agent-vault-api";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { readSetupJson } from "@/lib/infra/setup-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Accept-Encoding" };
const compress = promisify(gzip);
const failure = (error: unknown, status = 400) => NextResponse.json({ error: error instanceof Error ? error.message.slice(0, 300) : "Vault request failed" }, { status, headers });
export async function GET(req: NextRequest) {
  const context = await getSessionContext();
  if (!context) return failure(new Error("unauthorized"), 401);
  if (context.role !== "owner") return failure(new Error("owner_required"), 403);
  if (rateLimited(`agent-vault:read:${context.session.device_id}`, 60, 60_000)) return failure(new Error("rate_limited"), 429);
  try {
    const result = await getAgentVault(req.nextUrl.searchParams.get("project") ?? undefined, req.nextUrl.searchParams.get("note") ?? undefined);
    // shortcut: weighted gzip requests keep the existing identity response; expand negotiation if custom clients need them.
    // Note reads repeat the manifest; keep index timing unchanged while shrinking that second transfer.
    if (result.note && req.headers.get("Accept-Encoding")?.split(",").some(value => value.trim().toLowerCase() === "gzip")) {
      const body = JSON.stringify(result);
      if (Buffer.byteLength(body) >= 1024) return new NextResponse(new Uint8Array(await compress(body)), { headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Encoding": "gzip" } });
    }
    return NextResponse.json(result, { headers });
  }
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
