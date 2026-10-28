import { verifyAuth } from "@/lib/agent/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { collectMemoryGraph } from "./collect";

export async function handleGetMemoryGraph(req: Request): Promise<Response> {
  if (!(await verifyAuth(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const context = await getSessionContext();
  if (!context) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (context.role !== "owner") return Response.json({ error: "owner_required" }, { status: 403 });
  const url = new URL(req.url);
  const root = (url.searchParams.get("root") ?? process.env.OS_MEMORY_GRAPH_ROOT ?? "").trim().slice(0, 500);
  const project = (url.searchParams.get("project") ?? "").trim().slice(0, 200);
  try {
    const graph = await collectMemoryGraph({ root, project, principal: `cli:${context.session.device_id}`, ownerView: true });
    return Response.json(graph, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "memory graph failed";
    return Response.json({ error: message.slice(0, 200) }, { status: 500 });
  }
}
