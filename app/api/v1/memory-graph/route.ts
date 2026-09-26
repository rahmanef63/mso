import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { collectMemoryGraph } from "@/lib/memory-graph/collect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const context = await getSessionContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (context.role !== "owner") return NextResponse.json({ error: "owner_required" }, { status: 403 });
  const root = (req.nextUrl.searchParams.get("root") ?? process.env.OS_MEMORY_GRAPH_ROOT ?? "").trim().slice(0, 500);
  const project = (req.nextUrl.searchParams.get("project") ?? "").trim().slice(0, 200);
  try {
    const graph = await collectMemoryGraph({ root, project, principal: `cli:${context.session.device_id}`, ownerView: true });
    return NextResponse.json(graph, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "memory graph failed";
    return NextResponse.json({ error: message.slice(0, 200) }, { status: 500 });
  }
}
