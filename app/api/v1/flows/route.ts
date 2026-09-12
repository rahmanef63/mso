import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { createAgentSession } from "@/lib/agent/session-store";
import { readSetupJson } from "@/lib/infra/setup-http";
import { flowCatalog } from "@/lib/workflow/automation-catalog";
import { flowStatus } from "@/lib/workflow/automation-engine";
import { executeCapabilityCall } from "@/lib/capabilities/execute";
import { maxScope } from "@/lib/mcp/scope";
import { TOOLS_BY_NAME } from "@/lib/mcp/tools";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
const fail = (e: unknown) => NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 300) : "flow failed" }, { status: 400, headers });
export async function GET(req: NextRequest) {
  const auth = await getSessionContext();
  if (auth?.role !== "owner") return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  try {
    const q = req.nextUrl.searchParams;
    if (q.has("run_id")) return NextResponse.json(await flowStatus(q.get("run_id")!, { principal: "cli:" + auth.session.device_id, scope: maxScope() }, Number(q.get("wait_ms")) || 0), { headers });
    const { project, flows, revision } = await flowCatalog(q.get("project") ?? "", q.get("flow") || undefined);
    return NextResponse.json({ project: project.id, flows, revision }, { headers });
  } catch (e) { return fail(e); }
}
export async function POST(req: NextRequest) {
  const auth = await getSessionContext();
  if (auth?.role !== "owner") return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  try {
    const { action = "run", ...args } = await readSetupJson(req);
    const name = action === "run" ? "flow_run" : action === "upsert" || action === "delete" ? "flow_manage" : "";
    if (!name) throw new Error("unknown flow action");
    const principal = "cli:" + auth.session.device_id;
    const session = await createAgentSession(principal, "cli", { title: "Automation: " + String(args.flow ?? ""), titleSource: "auto" });
    const outcome = await executeCapabilityCall({ tool: TOOLS_BY_NAME.get(name)!, args: { ...args, ...(action === "run" ? {} : { action }) },
      actor: principal, scope: maxScope(), context: { principal, sessionId: session.id } });
    if (outcome.kind !== "success") throw new Error(outcome.message);
    return NextResponse.json(outcome.result, { headers });
  } catch (e) { return fail(e); }
}
