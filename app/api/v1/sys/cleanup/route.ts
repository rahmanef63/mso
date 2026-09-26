import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { apiError, readJson } from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { scanCleanup, runCleanup } from "@/lib/host/cleanup";
import { issueCleanupPreview, consumeCleanupPreview } from "@/lib/host/cleanup-preview";

export const dynamic = "force-dynamic";
const protectedCategories = new Set(["tmp-old"]);

async function owner(req: Request) {
  return (await verifyAuth(req)) && (await getSessionContext())?.role === "owner";
}

export async function GET(req: Request) {
  if (!(await owner(req))) return NextResponse.json({ error: "owner_required" }, { status: 403 });
  try {
    const items = (await scanCleanup()).map((item) => protectedCategories.has(item.id) ? {
      ...item, available: false,
      desc: "Protected: file age does not prove that sessions, evidence or builds no longer need it.",
    } : item);
    return NextResponse.json({
      items, preview: issueCleanupPreview(items),
      protected: ["session records", "memories", "evidence", "archives", "volumes", "unreviewed temporary files"],
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return apiError("sys/cleanup", e); }
}

export async function POST(req: Request) {
  if (!(await owner(req))) return NextResponse.json({ error: "owner_required" }, { status: 403 });
  try {
    const body = (await readJson(req)) as { ids?: unknown; preview_id?: unknown; confirm?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 32) : [];
    if (ids.some((id) => protectedCategories.has(id))) return NextResponse.json({ error: "protected_category" }, { status: 400 });
    consumeCleanupPreview(body.preview_id, ids, body.confirm);
    const results = await runCleanup(ids);
    const freed = results.reduce((sum, row) => sum + row.freedBytes, 0);
    audit({ action: "sys.cleanup", target: ids.join(","), ok: results.every((row) => row.ok), detail: `freed ${freed} bytes` });
    return NextResponse.json({ results });
  } catch (e) { return apiError("sys/cleanup", e); }
}
