import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { roleAtLeast } from "@/lib/auth/roles";
import { createAgentSession } from "@/lib/agent/session-store";
import { readSetupJson } from "@/lib/infra/setup-http";
import { maxScope } from "@/lib/mcp/scope";
import { TOOLS_BY_NAME } from "@/lib/mcp/tools";
import { cloneWorkflowGraph, createWorkflowGraph, deleteWorkflowGraph, getWorkflowGraph, listWorkflowGraphs, updateWorkflowGraph } from "@/lib/workflow/graph-store";
import { startWorkflowGraph, workflowGraphRunStatus } from "@/lib/workflow/graph-engine";
import { resolveWorkflowGraphNodeTarget } from "@/lib/workflow/graph-target";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
const fail = (error: unknown, status = 400) => NextResponse.json({ error: error instanceof Error ? error.message.slice(0, 500) : "workflow request failed" }, { status, headers });

async function auth(minimum: "viewer" | "operator" | "owner" = "viewer") {
  const context = await getSessionContext();
  if (!context?.session.device_id) return null;
  if (!roleAtLeast(context.role, minimum)) return null;
  return { context, principal: `web:${context.session.device_id}` };
}

export async function GET(req: NextRequest) {
  const session = await auth("viewer"); if (!session) return fail("unauthorized", 401);
  try {
    const q = req.nextUrl.searchParams;
    if (q.has("run_id")) return NextResponse.json(await workflowGraphRunStatus(session.principal, q.get("run_id")!, Number(q.get("wait_ms")) || 0), { headers });
    if (q.has("graph_id") && q.has("node_id") && q.get("resolve") === "target") {
      const graph = await getWorkflowGraph(session.principal, q.get("graph_id")!); if (!graph) throw new Error("workflow graph not found");
      return NextResponse.json(await resolveWorkflowGraphNodeTarget(graph, q.get("node_id")!), { headers });
    }
    if (q.has("graph_id")) {
      const graph = await getWorkflowGraph(session.principal, q.get("graph_id")!); if (!graph) return fail("workflow graph not found", 404);
      return NextResponse.json({ graph }, { headers });
    }
    return NextResponse.json({ graphs: await listWorkflowGraphs(session.principal) }, { headers });
  } catch (error) { return fail(error); }
}

export async function POST(req: NextRequest) {
  const session = await auth("operator"); if (!session) return fail("operator_required", 403);
  try {
    const body = await readSetupJson(req), action = typeof body.action === "string" ? body.action : "";
    if (action === "create") return NextResponse.json({ graph: await createWorkflowGraph(session.principal, body.graph) }, { headers });
    if (action === "update") return NextResponse.json({ graph: await updateWorkflowGraph(session.principal, String(body.graph_id ?? ""), String(body.expected_revision ?? ""), body.graph) }, { headers });
    if (action === "delete") return NextResponse.json(await deleteWorkflowGraph(session.principal, String(body.graph_id ?? ""), String(body.expected_revision ?? "")), { headers });
    if (action === "clone") return NextResponse.json({ graph: await cloneWorkflowGraph(session.principal, String(body.graph_id ?? "")) }, { headers });
    if (action === "run") {
      const graph = await getWorkflowGraph(session.principal, String(body.graph_id ?? "")); if (!graph) throw new Error("workflow graph not found");
      const agentSession = await createAgentSession(session.principal, "cli", { title: `Workflow: ${graph.name}`, titleSource: "auto" });
      const context = { principal: session.principal, actor: session.principal, sessionId: agentSession.id, scope: maxScope() } as const;
      return NextResponse.json(await startWorkflowGraph(graph, body.input ?? {}, String(body.idempotency_key ?? `${Date.now()}`), context, (name) => TOOLS_BY_NAME.get(name)), { headers });
    }
    throw new Error("unknown workflow action");
  } catch (error) { return fail(error); }
}
