import type { CapabilityRunContext, CapabilityTool } from "@/lib/capabilities/tool";
import { boundedResultText } from "@/lib/capabilities/result-budget";
import type { WorkflowGraph, WorkflowGraphRun } from "@/lib/contracts/workflow-graph";
import { graphObject } from "./graph-schema";
import { workflowPath } from "./graph-bindings";

type Resolver = (name: string) => CapabilityTool | undefined;

function compact(value: unknown): unknown {
  try {
    return JSON.parse(boundedResultText(typeof value === "string" ? { text: value } : value, {
      maxTextBytes: 12 * 1024,
      overflowHint: "Open the child workflow run receipt for full details.",
    }));
  } catch {
    return { text: String(value).slice(0, 12_000) };
  }
}

function explicitWorkflowOutput(
  graph: WorkflowGraph,
  run: Pick<WorkflowGraphRun, "id" | "state" | "nodes">,
): unknown {
  const outputs = graph.nodes
    .filter((node) => node.type === "output")
    .map((node) => ({ id: node.id, value: run.nodes.find((row) => row.id === node.id)?.output }))
    .filter((row) => row.value !== undefined);
  if (outputs.length === 1) return outputs[0]!.value;
  if (outputs.length > 1) return Object.fromEntries(outputs.map((row) => [row.id, row.value]));
  return { state: run.state, runId: run.id };
}

export async function runWorkflowGraphChild(
  workflowId: string,
  input: Record<string, unknown>,
  key: string,
  run: WorkflowGraphRun,
  graph: WorkflowGraph,
  context: CapabilityRunContext,
  resolve: Resolver,
  deadlineAt?: number,
) {
  const principal = context.principal ?? context.actor;
  if (!principal) throw new Error("workflow child requires principal");
  const { getWorkflowGraph } = await import("./graph-store");
  const { startWorkflowGraph, workflowGraphRunStatus } = await import("./graph-engine");
  const child = await getWorkflowGraph(principal, workflowId);
  if (!child) throw new Error("workflow child graph not found");
  const started = await startWorkflowGraph(
    child,
    input,
    key,
    context,
    resolve,
    principal,
    { type: "system", receivedAt: new Date().toISOString() },
    run.ancestry ?? [graph.id],
  );
  let latest = started;
  for (let polls = 0; polls < 24 && latest.state === "running"; polls += 1) {
    const remaining = deadlineAt === undefined ? 25_000 : deadlineAt - Date.now();
    if (remaining <= 0) throw new Error("repeat node exceeded maxDurationMs");
    latest = await workflowGraphRunStatus(principal, latest.id, Math.min(25_000, remaining));
  }
  if (latest.state === "failed" || latest.state === "interrupted" || latest.state === "running")
    throw new Error(`workflow child ${child.name} did not complete successfully`);
  return { child, latest };
}

export async function repeatWorkflow(
  config: Record<string, unknown>,
  run: WorkflowGraphRun,
  graph: WorkflowGraph,
  context: CapabilityRunContext,
  resolve: Resolver,
) {
  const workflowId = typeof config.workflowId === "string" ? config.workflowId.trim() : "";
  if (!workflowId) throw new Error("repeat node requires workflowId");
  const maxIterations = Math.trunc(Number(config.maxIterations ?? 5));
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > 50)
    throw new Error("repeat node maxIterations must be 1-50");
  const delayMs = Math.trunc(Number(config.delayMs ?? 0));
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 10 * 60_000)
    throw new Error("repeat node delayMs must be 0-600000");
  const maxDurationMs = Math.trunc(Number(config.maxDurationMs ?? 10 * 60_000));
  if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1_000 || maxDurationMs > 14 * 60_000)
    throw new Error("repeat node maxDurationMs must be 1000-840000");
  const path = typeof config.path === "string" && config.path.trim() ? config.path.trim() : "result.output";
  const baseInput = graphObject(config.input) ? structuredClone(config.input) : {};
  const deadlineAt = Date.now() + maxDurationMs;
  const iterations: Array<{ iteration: number; runId: string; state: string; matched: boolean; condition: unknown }> = [];
  let previous: unknown = null;
  let final: unknown = null;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    if (Date.now() >= deadlineAt) throw new Error("repeat node exceeded maxDurationMs");
    const childInput = { ...baseInput, repeat: { iteration, previous } };
    const { child, latest } = await runWorkflowGraphChild(
      workflowId,
      childInput,
      `${run.id}:${workflowId}:${iteration}`,
      run,
      graph,
      context,
      resolve,
      deadlineAt,
    );
    const output = explicitWorkflowOutput(child, latest);
    const result = { runId: latest.id, state: latest.state, output };
    const conditionValue = workflowPath({ result, iteration, previous }, path);
    const matched = Object.hasOwn(config, "equals")
      ? JSON.stringify(conditionValue) === JSON.stringify(config.equals)
      : Boolean(conditionValue);
    const safeOutput = compact(output);
    final = { iteration, ...result, output: safeOutput, condition: compact(conditionValue), matched };
    iterations.push({
      iteration,
      runId: latest.id,
      state: latest.state,
      matched,
      condition: compact(conditionValue),
    });
    if (matched) {
      return {
        output: { matched: true, exhausted: false, count: iteration, iterations, final },
        handles: ["done"],
        log: `Repeat Until matched after ${iteration} iteration(s).`,
      };
    }
    previous = { iteration, runId: latest.id, state: latest.state, output: safeOutput };
    if (iteration < maxIterations && delayMs > 0) {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0 || delayMs > remaining) throw new Error("repeat node exceeded maxDurationMs");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  }
  return {
    output: { matched: false, exhausted: true, count: maxIterations, iterations, final },
    handles: ["exhausted"],
    log: `Repeat Until exhausted after ${maxIterations} iteration(s).`,
  };
}
