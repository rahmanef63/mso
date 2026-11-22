import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { roleAtLeast } from "@/lib/auth/roles";
import { createAgentSession } from "@/lib/agent/session-store";
import { readSetupJson } from "@/lib/infra/setup-http";
import { rateLimited } from "@/lib/host/limits-api";
import { configuredCapabilityCeiling } from "@/lib/capabilities/scope-policy";
import { TOOLS_BY_NAME } from "@/lib/mcp/tools";
import { msoCapabilityRuntime } from "@/lib/mcp/capability-runtime";
import {
  cloneWorkflowGraph,
  createWorkflowGraph,
  deleteWorkflowGraph,
  getWorkflowGraph,
  updateWorkflowGraph,
  workflowGraphOwner,
} from "@/lib/workflow/graph-store";
import { requestWorkflowGraphStop, startWorkflowGraph } from "@/lib/workflow/graph-engine";
import { deleteWorkflowGraphRun, readWorkflowGraphRun } from "@/lib/workflow/graph-run-store";
import { readWorkflowGraphVersion } from "@/lib/workflow/graph-version-store";
import { deleteWorkflowVariable, setWorkflowVariable } from "@/lib/workflow/variables";
import { requireWorkflowReceiptAuthority } from "@/lib/workflow/graph-authority";
import { workflowTemplate } from "@/lib/workflow/templates";
import { suggestWorkflowGraph } from "@/lib/workflow/ai-assist";
import {
  createWorkflowDataTable,
  deleteWorkflowDataTable,
  deleteWorkflowDataTableRow,
  upsertWorkflowDataTableRow,
} from "@/lib/workflow/data-table-store";
import { optimizeWorkflowGraph } from "@/lib/workflow/graph-optimizer";
import { createJevDecisionEvaluator } from "@/lib/workflow/jev-decision-plane";
import { cloneOwnerGraph } from "@/lib/workflow/owner-discovery";

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

function definition(graph: NonNullable<Awaited<ReturnType<typeof getWorkflowGraph>>>) {
  const { revision: _r, createdAt: _c, updatedAt: _u, version: _v, ...rest } = graph;
  return rest;
}

export async function handlePostWorkflow(req: NextRequest): Promise<Response> {
  const session = await auth("operator");
  if (!session) return fail("operator_required", 403);
  try {
    const body = await readSetupJson(req);
    const action = typeof body.action === "string" ? body.action : "";
    if (rateLimited(`workflow:${action}:${session.context.session.device_id}`, action === "run" ? 60 : 30, 60_000)) {
      return fail("rate_limited", 429);
    }
    if (action === "owner_clone") {
      if (session.context.role !== "owner") return fail("owner_required", 403);
      if (body.confirm !== true) return fail("explicit_confirmation_required", 400);
      return NextResponse.json({
        graph: await cloneOwnerGraph(session.context.role, session.principal, String(body.origin_owner ?? ""), String(body.graph_id ?? ""), String(body.expected_revision ?? "")),
      }, { headers });
    }
    if (action === "create") {
      return NextResponse.json({ graph: await createWorkflowGraph(session.principal, body.graph, "create", { remember: true }) }, { headers });
    }
    if (action === "update") {
      return NextResponse.json({
        graph: await updateWorkflowGraph(session.principal, String(body.graph_id ?? ""), String(body.expected_revision ?? ""), body.graph, "update", { remember: true }),
      }, { headers });
    }
    if (action === "delete") {
      return NextResponse.json(await deleteWorkflowGraph(session.principal, String(body.graph_id ?? ""), String(body.expected_revision ?? "")), { headers });
    }
    if (action === "clone") {
      return NextResponse.json({ graph: await cloneWorkflowGraph(session.principal, String(body.graph_id ?? ""), { remember: true }) }, { headers });
    }
    if (action === "create_from_template") {
      const row = workflowTemplate(String(body.template_id ?? ""));
      if (!row) throw new Error("workflow template not found");
      return NextResponse.json({ graph: await createWorkflowGraph(session.principal, row.definition, "template", { remember: true }) }, { headers });
    }
    if (action === "restore_version") {
      const id = String(body.graph_id ?? "");
      const snapshot = await readWorkflowGraphVersion(workflowGraphOwner(session.principal), id, String(body.revision ?? ""));
      if (!snapshot) throw new Error("workflow version not found");
      return NextResponse.json({
        graph: await updateWorkflowGraph(session.principal, id, String(body.expected_revision ?? ""), definition(snapshot.graph), "restore", { remember: true }),
      }, { headers });
    }
    if (action === "variable_set" || action === "variable_delete") {
      if (!roleAtLeast(session.context.role, "owner")) return fail("owner_required", 403);
      return NextResponse.json(
        action === "variable_set"
          ? await setWorkflowVariable(session.principal, String(body.key ?? ""), body.value, body.secret === true)
          : await deleteWorkflowVariable(session.principal, String(body.key ?? "")),
        { headers },
      );
    }
    if (action === "ai_suggest") {
      if (!roleAtLeast(session.context.role, "owner")) return fail("owner_required", 403);
      return NextResponse.json({ definition: await suggestWorkflowGraph(String(body.prompt ?? "")) }, { headers });
    }
    if (action === "optimize_preview" || action === "optimize_clone") {
      const graph = await getWorkflowGraph(session.principal, String(body.graph_id ?? ""));
      if (!graph) throw new Error("workflow graph not found");
      if (action === "optimize_clone" && String(body.expected_revision ?? "") !== graph.revision) {
        throw new Error("workflow graph revision changed; refresh before optimizing");
      }
      const mode = body.mode === "jev" ? ("jev" as const) : ("deterministic" as const);
      let evaluator;
      if (mode === "jev") {
        if (!roleAtLeast(session.context.role, "owner")) return fail("owner_required", 403);
        evaluator = createJevDecisionEvaluator("workflow.optimize", body.jev, { workflowRef: graph.id }, Number(body.threshold) || undefined);
      }
      const optimized = await optimizeWorkflowGraph(graph, {
        mode,
        threshold: Number(body.threshold) || undefined,
        applyReview: body.apply_review === true,
        evaluator,
        resolveTool: (name) => TOOLS_BY_NAME.get(name),
      });
      if (action === "optimize_preview") return NextResponse.json({ optimization: optimized.preview }, { headers });
      if (optimized.preview.summary.selectedCount < 1) {
        throw new Error("no optimization candidate selected; analyze first or enable review transformations");
      }
      const next = optimized.definition as Record<string, unknown>;
      const meta = next.metadata && typeof next.metadata === "object" && !Array.isArray(next.metadata) ? (next.metadata as Record<string, unknown>) : {};
      const tags = Array.isArray(meta.tags) ? meta.tags.filter((value): value is string => typeof value === "string") : [];
      next.name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 160) : `${graph.name} · Optimized`.slice(0, 160);
      next.status = "draft";
      next.metadata = {
        ...meta,
        provenance: "ai-assisted",
        fingerprint: undefined,
        tags: [...new Set([...tags, "optimized", optimized.preview.provider === "jev" ? "jev" : "deterministic"])].slice(0, 32),
      };
      return NextResponse.json({
        graph: await createWorkflowGraph(session.principal, next, "create", { remember: true }),
        optimization: optimized.preview,
      }, { headers });
    }
    if (action === "data_table_create") {
      return NextResponse.json({ table: await createWorkflowDataTable(session.principal, body.name, body.columns) }, { headers });
    }
    if (action === "data_table_delete") {
      return NextResponse.json(await deleteWorkflowDataTable(session.principal, body.table_id), { headers });
    }
    if (action === "data_table_row_upsert") {
      return NextResponse.json({ row: await upsertWorkflowDataTableRow(session.principal, body.table_id, body.row_id, body.values) }, { headers });
    }
    if (action === "data_table_row_delete") {
      return NextResponse.json(await deleteWorkflowDataTableRow(session.principal, body.table_id, body.row_id), { headers });
    }
    if (action === "run_stop") {
      return NextResponse.json(await requestWorkflowGraphStop(session.principal, String(body.run_id ?? "")), { headers });
    }
    if (action === "run_delete") {
      return NextResponse.json(await deleteWorkflowGraphRun(workflowGraphOwner(session.principal), String(body.run_id ?? "")), { headers });
    }
    if (action === "run_retry") {
      const prior = await readWorkflowGraphRun(workflowGraphOwner(session.principal), String(body.run_id ?? ""));
      if (!prior) throw new Error("workflow execution not found");
      await requireWorkflowReceiptAuthority(session.principal, prior);
      if (prior.state === "running") throw new Error("running execution must be stopped before retry");
      if (!prior.runtimeInput) throw new Error("execution predates retry input retention; run the workflow again instead");
      const graph = await getWorkflowGraph(session.principal, prior.graphId);
      if (!graph) throw new Error("workflow graph not found");
      if (graph.revision !== prior.graphRevision) throw new Error("workflow changed since this execution; run the current workflow instead of retrying stale input");
      const agentSession = await createAgentSession(session.principal, "cli", { title: `Workflow retry: ${graph.name}`, titleSource: "auto" });
      const context = { principal: session.principal, actor: session.principal, sessionId: agentSession.id, scope: configuredCapabilityCeiling(), capabilities: msoCapabilityRuntime } as const;
      return NextResponse.json(await startWorkflowGraph(graph, prior.runtimeInput, String(body.idempotency_key ?? `retry:${prior.id}:${Date.now()}`), context, (name) => TOOLS_BY_NAME.get(name)), { headers });
    }
    if (action === "run") {
      const graph = await getWorkflowGraph(session.principal, String(body.graph_id ?? ""));
      if (!graph) throw new Error("workflow graph not found");
      if (body.expected_revision !== undefined) {
        if (typeof body.expected_revision !== "string" || !/^[a-f0-9]{64}$/.test(body.expected_revision)) {
          return fail("invalid expected workflow revision", 400);
        }
        if (body.expected_revision !== graph.revision) {
          return fail("workflow graph revision changed; review it before running", 409);
        }
      }
      const agentSession = await createAgentSession(session.principal, "cli", { title: `Workflow: ${graph.name}`, titleSource: "auto" });
      const context = { principal: session.principal, actor: session.principal, sessionId: agentSession.id, scope: configuredCapabilityCeiling(), capabilities: msoCapabilityRuntime } as const;
      return NextResponse.json(await startWorkflowGraph(graph, body.input ?? {}, String(body.idempotency_key ?? `${Date.now()}`), context, (name) => TOOLS_BY_NAME.get(name)), { headers });
    }
    throw new Error("unknown workflow action");
  } catch (error) {
    return fail(error);
  }
}
