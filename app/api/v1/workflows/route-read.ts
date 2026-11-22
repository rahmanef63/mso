import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { roleAtLeast } from "@/lib/auth/roles";
import { listAgentSessions } from "@/lib/agent/session-store";
import { agentSessionLabel } from "@/lib/agent/session-name";
import { configuredCapabilityCeiling } from "@/lib/capabilities/scope-policy";
import { msoCapabilityRuntime } from "@/lib/mcp/capability-runtime";
import { listProjects, resolveProjectHint } from "@/lib/host/projects-api";
import { catalogSkillsDetailed } from "@/lib/skills/catalog";
import { getWorkflowGraph, listWorkflowGraphs, workflowGraphOwner } from "@/lib/workflow/graph-store";
import { workflowGraphRunStatus } from "@/lib/workflow/graph-engine";
import { listWorkflowGraphRuns } from "@/lib/workflow/graph-run-store";
import { listWorkflowGraphVersions } from "@/lib/workflow/graph-version-store";
import { resolveWorkflowGraphNodeTarget } from "@/lib/workflow/graph-target";
import { listWorkflowVariables } from "@/lib/workflow/variables";
import { workflowNodeCatalog } from "@/lib/workflow/node-catalog";
import { workflowExecutionContext } from "@/lib/workflow/graph-authority";
import { workflowTemplates } from "@/lib/workflow/templates";
import { workflowMatchesQuery } from "@/lib/workflow/search";
import { listAutomationScripts } from "@/lib/orchestration/repo-memory-artifacts";
import { getWorkflowDataTable, listWorkflowDataTables } from "@/lib/workflow/data-table-store";
import { learningPage } from "@/lib/workflow/learning-page";
import { discoverOwnerGraphs } from "@/lib/workflow/owner-discovery";

const headers = { "Cache-Control": "no-store, private" };

const fail = (error: unknown, status = 400) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) || "workflow request failed" },
    { status, headers },
  );

async function auth(minimum: "viewer" | "operator" | "owner" = "viewer") {
  const context = await getSessionContext();
  if (!context?.session.device_id || !roleAtLeast(context.role, minimum)) return null;
  return { context, principal: `web:${context.session.device_id}` };
}

export async function handleGetWorkflow(req: NextRequest): Promise<Response> {
  const q = req.nextUrl.searchParams;
  const minimum = (q.has("variables") || q.has("data_tables") || q.has("data_table")) ? "operator" : "viewer";
  const session = await auth(minimum);
  if (!session) return fail("unauthorized", 401);
  try {
    if (q.get("owner_view") === "1") {
      if (session.context.role !== "owner") return fail("owner_required", 403);
      return NextResponse.json(await discoverOwnerGraphs(session.context.role, session.principal, Number(q.get("owner_offset")) || 0), { headers });
    }
    if (q.get("directory") === "1") {
      const authority = session.context.role === "viewer"
        ? { scope: "read" as const, allowedTools: undefined }
        : await workflowExecutionContext({ principal: session.principal, scope: configuredCapabilityCeiling(), capabilities: msoCapabilityRuntime });
      const query = (q.get("q") ?? "").toLowerCase().trim();
      const tools = msoCapabilityRuntime.list(authority.scope).filter((tool) =>
        (!authority.allowedTools || authority.allowedTools.includes(tool.name)) &&
        (!query || `${tool.name} ${tool.description} ${tool.scope}`.toLowerCase().includes(query)),
      ).slice(0, 150);
      const operator = roleAtLeast(session.context.role, "operator");
      const [graphs, sessions, projectResult, skillResult] = await Promise.all([
        listWorkflowGraphs(session.principal),
        listAgentSessions(session.principal, 50),
        operator ? listProjects({ query: query || undefined, limit: 100 }) : Promise.resolve(null),
        operator ? catalogSkillsDetailed() : Promise.resolve(null),
      ]);
      const projects = projectResult?.projects.map((row) => ({
        id: row.id,
        name: row.name,
        ...(row.packageName ? { packageName: row.packageName } : {}),
        ...(row.packageVersion ? { packageVersion: row.packageVersion } : {}),
        ...(row.git?.branch ? { branch: row.git.branch } : {}),
        ...(row.git?.head ? { head: row.git.head } : {}),
      })) ?? [];
      const skills = skillResult?.skills.filter((row) =>
        !query || `${row.id} ${row.name} ${row.description} ${row.source} ${row.trust} ${row.project?.name ?? ""}`.toLowerCase().includes(query),
      ).slice(0, 150).map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        source: row.source,
        trust: row.trust,
        ...(row.project ? { project: row.project.name } : {}),
      })) ?? [];
      return NextResponse.json({
        tools,
        workflows: graphs.filter((graph) =>
          !query || `${graph.name} ${graph.description} ${(graph.metadata.tags ?? []).join(" ")}`.toLowerCase().includes(query),
        ).map((graph) => ({
          id: graph.id,
          name: graph.name,
          status: graph.status,
          nodeCount: graph.nodes.length,
          updatedAt: graph.updatedAt,
        })),
        sessions: sessions.filter((row) =>
          !query || `${agentSessionLabel(row.name, row.title, row.cwd)} ${row.title} ${row.name} ${row.cwd ?? ""}`.toLowerCase().includes(query),
        ).map((row) => ({ ...row, label: agentSessionLabel(row.name, row.title, row.cwd) })),
        projects,
        skills,
      }, { headers });
    }
    if (q.get("scripts") === "1") {
      const hint = q.get("project")?.trim();
      if (!hint) throw new Error("project is required");
      const project = await resolveProjectHint(hint);
      if (!project || project.matchedBy === "fuzzy") throw new Error("exact project not found");
      const query = (q.get("q") ?? "").toLowerCase().trim();
      const scripts = (await listAutomationScripts(project.path)).filter((script) =>
        !query || `${script.id} ${script.intent} ${script.status} ${script.steps.map((step) => step.tool).join(" ")}`.toLowerCase().includes(query),
      ).map((script) => ({
        id: script.id,
        intent: script.intent,
        status: script.status,
        stepCount: script.steps.length,
        updatedAt: script.updatedAt,
        project: script.project,
        tools: script.steps.map((step) => step.tool),
      }));
      return NextResponse.json({ project: project.id, scripts }, { headers });
    }
    if (q.get("learning") === "1") {
      if (!roleAtLeast(session.context.role, "owner")) return fail("owner_required", 403);
      return NextResponse.json(await learningPage({
        offset: Number(q.get("offset")) || 0,
        limit: Number(q.get("limit")) || 40,
        includeArchived: q.get("include_archived") === "1",
        sessionLabel: q.get("session_label")?.slice(0, 200) || undefined,
      }), { headers });
    }
    if (q.get("catalog") === "1") return NextResponse.json({ nodes: workflowNodeCatalog(q.get("q") ?? "") }, { headers });
    if (q.get("templates") === "1") return NextResponse.json({ templates: workflowTemplates() }, { headers });
    if (q.get("variables") === "1") return NextResponse.json({ variables: await listWorkflowVariables(session.principal) }, { headers });
    if (q.get("data_tables") === "1") return NextResponse.json({ tables: await listWorkflowDataTables(session.principal) }, { headers });
    if (q.has("data_table")) return NextResponse.json({ table: await getWorkflowDataTable(session.principal, q.get("data_table")) }, { headers });
    if (q.get("runs") === "1") {
      return NextResponse.json(await listWorkflowGraphRuns(workflowGraphOwner(session.principal), {
        graphId: q.get("graph_id") || undefined,
        state: (q.get("state") || undefined) as never,
        limit: Number(q.get("limit")) || 30,
        offset: Number(q.get("offset")) || 0,
      }), { headers });
    }
    if (q.has("versions")) {
      const graphId = q.get("versions")!;
      return NextResponse.json({ versions: await listWorkflowGraphVersions(workflowGraphOwner(session.principal), graphId) }, { headers });
    }
    if (q.has("run_id")) return NextResponse.json(await workflowGraphRunStatus(session.principal, q.get("run_id")!, Number(q.get("wait_ms")) || 0), { headers });
    if (q.has("graph_id") && q.has("node_id") && q.get("resolve") === "target") {
      const graph = await getWorkflowGraph(session.principal, q.get("graph_id")!);
      if (!graph) throw new Error("workflow graph not found");
      return NextResponse.json(await resolveWorkflowGraphNodeTarget(graph, q.get("node_id")!), { headers });
    }
    if (q.has("graph_id")) {
      const graph = await getWorkflowGraph(session.principal, q.get("graph_id")!);
      if (!graph) return fail("workflow graph not found", 404);
      return NextResponse.json({ graph }, { headers });
    }
    const graphs = await listWorkflowGraphs(session.principal);
    const query = q.get("q") ?? "";
    const filters = {
      tag: q.get("tag") || undefined,
      status: q.get("status") || undefined,
      project: q.get("project") || undefined,
      folder: q.get("folder") || undefined,
      node: q.get("node") || undefined,
    };
    return NextResponse.json({ graphs: graphs.filter((graph) => workflowMatchesQuery(graph, query, filters)) }, { headers });
  } catch (error) {
    return fail(error);
  }
}
