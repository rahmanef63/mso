import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { apiError, readJson } from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { scanCleanup, runCleanup } from "@/lib/host/cleanup";

export const dynamic = "force-dynamic";

// GET /sys/cleanup → reclaimable bytes per safe cleanup category.
export async function GET(req: Request) {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    return NextResponse.json({ items: await scanCleanup() });
  } catch (e) {
    return apiError("sys/cleanup", e);
  }
}

// POST /sys/cleanup {ids:[...]} → run the selected categories. ids are matched
// against the fixed server-side allowlist; anything else is reported back as
// unknown, never executed.
export async function POST(req: Request) {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = (await readJson(req)) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 32)
      : [];
    if (!ids.length)
      return NextResponse.json({ error: "ids required" }, { status: 400 });
    const results = await runCleanup(ids);
    const freed = results.reduce((a, r) => a + r.freedBytes, 0);
    audit({
      action: "sys.cleanup",
      target: ids.join(","),
      ok: results.every((r) => r.ok),
      detail: `freed ${freed} bytes`,
    });
    return NextResponse.json({ results });
  } catch (e) {
    return apiError("sys/cleanup", e);
  }
}
