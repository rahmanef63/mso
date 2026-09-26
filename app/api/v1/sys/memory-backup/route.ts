import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { readJson, apiError } from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { previewMemoryBackup, createMemoryBackup, verifyMemoryBackup, listMemoryBackups } from "@/lib/host/memory-backup-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  const response = apiError("sys/memory-backup", error);
  response.headers.set("Cache-Control", headers["Cache-Control"]);
  return response;
}
async function owner(req: Request) {
  if (!(await verifyAuth(req))) return null;
  const context = await getSessionContext();
  return context?.role === "owner" ? context : null;
}
export async function GET(req: Request) {
  if (!(await owner(req))) return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  try {
    const query = new URL(req.url).searchParams;
    if (query.get("view") === "history") {
      const offset = query.get("offset") ?? "0";
      if (!/^\d{1,5}$/.test(offset)) return NextResponse.json({ error: "invalid_history_offset" }, { status: 400, headers });
      return NextResponse.json(await listMemoryBackups({ offset: Number(offset), revision: query.get("revision") ?? undefined }), { headers });
    }
    if (query.has("view")) return NextResponse.json({ error: "unknown_view" }, { status: 400, headers });
    return NextResponse.json(await previewMemoryBackup(), { headers });
  }
  catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  const context = await owner(req);
  if (!context) return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  if (rateLimited(`memory-backup:${context.session.device_id}`, 3, 60_000)) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers });
  try {
    const body = await readJson(req) as { action?: unknown; confirm?: unknown; id?: unknown; manifest_sha256?: unknown };
    if (body.confirm !== true) return NextResponse.json({ error: "explicit_confirmation_required" }, { status: 400, headers });
    if (body.action !== "create" && body.action !== "verify") return NextResponse.json({ error: "unknown_action" }, { status: 400, headers });
    const result = body.action === "create" ? await createMemoryBackup() : await verifyMemoryBackup(String(body.id ?? ""), String(body.manifest_sha256 ?? ""));
    await audit({ action: "sys.memory-backup", target: result.id, ok: true, detail: String(body.action) });
    return NextResponse.json(result, { headers });
  } catch (error) { return failure(error); }
}
