import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { readSetupJson } from "@/lib/infra/setup-http";
import { executeCapabilityCall } from "@/lib/capabilities/execute";
import { maxScope } from "@/lib/mcp/scope";
import { PROJECT_MCP_TOOLS } from "@/lib/mcp/tools-project-mcp";
import { IS_DEMO } from "@/lib/demo";
import { PROJECT_MCP_MANAGE_TOOLS } from "@/lib/mcp/tools-project-mcp-manage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const headers = { "Cache-Control": "no-store, private" };
  const auth = await getSessionContext();
  if (IS_DEMO || auth?.role !== "owner") return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  try {
    const args = await readSetupJson(req), actor = "device:" + auth.session.device_id;
    const tool = args.action === "tools" ? PROJECT_MCP_TOOLS[0] : PROJECT_MCP_MANAGE_TOOLS[0];
    if (args.action === "tools") delete args.action;
    const result = await executeCapabilityCall({ tool, args, actor, scope: maxScope(), context: { principal: actor } });
    if (result.kind !== "success") throw new Error(result.message);
    return NextResponse.json(result.result, { headers });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 300) : "MCP operation failed" }, { status: 400, headers }); }
}
