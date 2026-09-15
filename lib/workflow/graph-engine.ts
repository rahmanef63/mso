import { createHash, randomUUID } from "node:crypto";
import type { CapabilityRunContext, CapabilityTool } from "@/lib/capabilities/tool";
import type { WorkflowGraph, WorkflowGraphRun } from "@/lib/contracts/workflow-graph";
import { redactText } from "@/lib/security/redact-text";
import { assertWorkflowMetadataOnly, graphObject } from "./graph-schema";
import { workflowGraphOwner } from "./graph-store";
import { compact, executeNode } from "./graph-runtime";
import { lockWorkflowGraphRun, pruneWorkflowGraphRuns, publicWorkflowGraphRun, readWorkflowGraphRun, writeWorkflowGraphRun } from "./graph-run-store";

const state = globalThis as typeof globalThis & { msoGraphInstance?: string; msoGraphPending?: Map<string, Promise<void>> };
const INSTANCE = state.msoGraphInstance ??= randomUUID();
const pending = state.msoGraphPending ??= new Map<string, Promise<void>>();
type Resolver = (name: string) => CapabilityTool | undefined;

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value);
}
function inputObject(raw: unknown): Record<string, unknown> {
  if (!graphObject(raw) || Buffer.byteLength(JSON.stringify(raw)) > 64 * 1024) throw new Error("workflow graph input must be an object up to 64 KiB");
  assertWorkflowMetadataOnly(raw); return structuredClone(raw);
}

async function execute(run: WorkflowGraphRun, graph: WorkflowGraph, input: Record<string, unknown>, context: CapabilityRunContext, resolve: Resolver): Promise<void> {
  const rows = new Map(run.nodes.map((row) => [row.id, row])), outputs: Record<string, unknown> = {};
  const edgeState = new Map(graph.edges.map((edge) => [edge.id, "pending" as "pending" | "enabled" | "disabled"]));
  const incoming = new Map(graph.nodes.map((node) => [node.id, graph.edges.filter((edge) => edge.target === node.id)]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, graph.edges.filter((edge) => edge.source === node.id)]));
  const disableOutgoing = (nodeId: string) => { for (const edge of outgoing.get(nodeId) ?? []) if (edgeState.get(edge.id) === "pending") edgeState.set(edge.id, "disabled"); };
  const resolveOutgoing = (nodeId: string, branch?: boolean) => {
    for (const edge of outgoing.get(nodeId) ?? []) {
      if (branch === undefined || !edge.sourceHandle) edgeState.set(edge.id, "enabled");
      else edgeState.set(edge.id, edge.sourceHandle === String(branch) ? "enabled" : "disabled");
    }
  };

  try {
    let remaining = new Set(graph.nodes.map((node) => node.id));
    while (remaining.size) {
      if (Date.now() - Date.parse(run.startedAt) > 15 * 60_000) throw new Error("workflow graph exceeded 15 minutes; remaining nodes were not started");
      let progressed = false;
      for (const node of graph.nodes) {
        if (!remaining.has(node.id)) continue;
        const deps = incoming.get(node.id) ?? [];
        if (deps.some((edge) => edgeState.get(edge.id) === "pending")) continue;
        const row = rows.get(node.id)!;
        if (node.disabled || (deps.length > 0 && deps.every((edge) => edgeState.get(edge.id) === "disabled"))) {
          row.state = "skipped"; row.finishedAt = new Date().toISOString(); row.logs.push(node.disabled ? "Node disabled by workflow definition." : "Skipped because no incoming branch was selected.");
          disableOutgoing(node.id); remaining.delete(node.id); progressed = true; run.updatedAt = new Date().toISOString(); await writeWorkflowGraphRun(run); continue;
        }
        row.state = "running"; row.startedAt = new Date().toISOString(); row.logs.push("Node started."); run.updatedAt = row.startedAt; await writeWorkflowGraphRun(run);
        const started = Date.now();
        try {
          const result = await executeNode(node, run, graph, input, outputs, context, resolve);
          row.output = compact(result.output); row.state = "completed"; outputs[node.id] = result.output;
          if (result.log) row.logs.push(result.log); resolveOutgoing(node.id, result.branch);
        } catch (error) {
          row.state = "failed"; row.error = redactText(error instanceof Error ? error.message : "node failed", 800); row.logs.push(row.error);
          run.failedNodeId = node.id; run.failedNodeName = node.name; run.error = row.error; run.state = "failed";
          for (const pendingId of remaining) {
            if (pendingId === node.id) continue;
            const blocked = rows.get(pendingId)!; if (blocked.state === "queued") { blocked.state = "blocked"; blocked.logs.push(`Blocked by failed node ${node.name}.`); }
          }
          throw error;
        } finally {
          row.durationMs = Date.now() - started; row.finishedAt = new Date().toISOString(); run.updatedAt = row.finishedAt; await writeWorkflowGraphRun(run);
        }
        remaining.delete(node.id); progressed = true;
      }
      if (!progressed && remaining.size) throw new Error("workflow graph could not make progress; inspect dependencies/branches");
    }
    run.state = "completed";
  } catch (error) {
    if (run.state !== "failed") { run.state = "failed"; run.error = redactText(error instanceof Error ? error.message : "workflow graph failed", 800); }
  }
  run.finishedAt = run.updatedAt = new Date().toISOString(); await writeWorkflowGraphRun(run);
}

export async function startWorkflowGraph(graph: WorkflowGraph, rawInput: unknown, idempotencyKey: string, context: CapabilityRunContext, resolve: Resolver, storagePrincipal?: string) {
  if (!(storagePrincipal ?? context.principal) || !context.sessionId) throw new Error("workflow graph requires an authenticated principal/session");
  if (graph.status === "archived") throw new Error("archived workflow graph cannot run");
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(idempotencyKey)) throw new Error("idempotency_key must be 1-128 simple characters");
  const owner = workflowGraphOwner(storagePrincipal ?? context.principal!), input = inputObject(rawInput), fingerprint = hash(canonical({ graphId: graph.id, revision: graph.revision, input }));
  const id = hash(`${owner}:${idempotencyKey}`).slice(0, 32);
  return lockWorkflowGraphRun(owner, id, async () => {
    const existing = await readWorkflowGraphRun(owner, id);
    if (existing) { if (existing.fingerprint !== fingerprint) throw new Error("idempotency_key already identifies a different graph/input/revision"); return publicWorkflowGraphRun(existing); }
    await pruneWorkflowGraphRuns(owner);
    const run: WorkflowGraphRun = {
      version: 1, id, owner, sessionId: context.sessionId!, graphId: graph.id, graphRevision: graph.revision, graphName: graph.name,
      idempotencyKey, fingerprint, state: "running", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), pid: process.pid, instance: INSTANCE,
      nodes: graph.nodes.map((node) => ({ id: node.id, name: node.name, type: node.type, state: "queued", logs: [] })),
    };
    await writeWorkflowGraphRun(run);
    const work = execute(run, graph, input, context, resolve).catch(() => undefined).finally(() => pending.delete(id)); pending.set(id, work);
    return publicWorkflowGraphRun(run);
  });
}

export async function workflowGraphRunStatus(principal: string, id: string, waitMs = 0) {
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 25_000) throw new Error("wait_ms must be 0-25000");
  const owner = workflowGraphOwner(principal); let run = await readWorkflowGraphRun(owner, id);
  if (!run) throw new Error("workflow graph run not found for this principal");
  if (run.state === "running" && pending.has(id) && waitMs > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([pending.get(id), new Promise((resolve) => { timer = setTimeout(resolve, waitMs); })]); clearTimeout(timer); run = await readWorkflowGraphRun(owner, id) ?? run;
  }
  if (run.state === "running" && run.instance !== INSTANCE) {
    let gone = false; try { process.kill(run.pid, 0); } catch (error) { gone = (error as NodeJS.ErrnoException).code === "ESRCH"; }
    if (gone) { run.state = "interrupted"; run.updatedAt = run.finishedAt = new Date().toISOString(); await writeWorkflowGraphRun(run); }
  }
  return publicWorkflowGraphRun(run);
}
