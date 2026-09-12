import { capabilityReportedFailure } from "@/lib/capabilities/result-outcome";
import { randomUUID } from "node:crypto";
import { executeCapabilityCall } from "@/lib/capabilities/execute";
import { isCapabilityDirectResult, type CapabilityRunContext, type CapabilityTool } from "@/lib/capabilities/tool";
import { boundedResultText } from "@/lib/capabilities/result-budget";
import { redactText } from "@/lib/security/redact-text";
import type { AutomationFlow, FlowRun } from "@/lib/contracts/automation";
import { flowInputs, flowStepArgs, flowValue, object } from "./automation-schema";
import { flowHash, flowOwner, lockFlowOwner, lockFlowRun, pruneFlowReceipts, publicFlowRun, readFlowRun, writeFlowRun } from "./automation-store";

const state = globalThis as typeof globalThis & { msoFlowInstance?: string; msoFlowPending?: Map<string, Promise<void>> };
const INSTANCE = state.msoFlowInstance ??= randomUUID();
const pending = state.msoFlowPending ??= new Map<string, Promise<void>>();
type Resolver = (name: string) => CapabilityTool | undefined;
function principal(context: CapabilityRunContext) {
  if (!context.principal) throw new Error("flow requires an authenticated agent session");
  return context.principal;
}
function canonical(v: unknown): string {
  return JSON.stringify(v && typeof v === "object" ? Array.isArray(v) ? v.map(x => JSON.parse(canonical(x))) :
    Object.fromEntries(Object.entries(v).sort(([a],[b]) => a.localeCompare(b)).map(([k,x]) => [k, JSON.parse(canonical(x))])) : v);
}
function resultData(result: unknown) {
  if (capabilityReportedFailure(result)) throw new Error("downstream tool reported an error");
  if (!isCapabilityDirectResult(result)) return result;
  if (result.isError) throw new Error("downstream tool reported an error");
  if (result.structuredContent) return result.structuredContent;
  const text = result.content.filter(c => c.type === "text").map(c => c.text).join("\n");
  try { return JSON.parse(text); } catch { return { text }; }
}
async function execute(run: FlowRun, flow: AutomationFlow, input: Record<string, unknown>, context: CapabilityRunContext, resolve: Resolver) {
  const steps: Record<string, unknown> = {};
  try {
    for (const step of flow.steps) {
      if (Date.now() - Date.parse(run.startedAt) > 10 * 60_000) throw new Error("flow exceeded 10 minutes; later steps were not started");
      const tool = resolve(step.tool);
      if (!tool) throw new Error("flow tool unavailable: " + step.tool);
      const args = flowStepArgs(step, { input, steps, project: run.project }, context.workflowId);
      const row: FlowRun["steps"][number] = { id: step.id, tool: step.tool, state: "running" };
      run.steps.push(row); run.updatedAt = new Date().toISOString(); await writeFlowRun(run);
      const started = Date.now();
      try {
        const outcome = await executeCapabilityCall({ tool, args, scope: context.scope, actor: context.actor, context });
        if (outcome.kind !== "success") throw new Error(outcome.message);
        const data = resultData(outcome.result);
        if (step.expect && canonical(flowValue(data, step.expect.path)) !== canonical(step.expect.equals)) throw new Error("flow expectation failed: " + step.expect.path);
        const value = JSON.parse(boundedResultText(typeof data === "string" ? { text: data } : data, { maxTextBytes: 12 * 1024, overflowHint: "Read the provider/project result directly for full details." }));
        steps[step.id] = data; row.result = value; row.state = "completed";
      } catch (error) {
        row.state = "failed"; row.error = redactText(error instanceof Error ? error.message : "step failed", 500); throw error;
      } finally { row.durationMs = Date.now() - started; run.updatedAt = new Date().toISOString(); await writeFlowRun(run); }
    }
    run.state = "completed";
  } catch (error) { run.state = "failed"; run.error = redactText(error instanceof Error ? error.message : "flow failed", 500); }
  run.finishedAt = run.updatedAt = new Date().toISOString(); await writeFlowRun(run);
}
export async function startFlow(flow: AutomationFlow, project: string, raw: unknown, key: string, context: CapabilityRunContext, resolve: Resolver) {
  if (!context.sessionId) throw new Error("flow requires an authenticated agent session");
  const owner = flowOwner(principal(context));
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(key)) throw new Error("idempotency_key must be 1-128 simple characters");
  const input = flowInputs(flow, raw), fingerprint = flowHash(canonical({ flow, input, project }));
  const id = flowHash(owner + ":" + key).slice(0, 32);
  return lockFlowOwner(owner, () => lockFlowRun(owner, id, async () => {
    const existing = await readFlowRun(owner, id);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error("idempotency_key already identifies different flow/input/project");
      return publicFlowRun(existing);
    }
    for (const step of flow.steps) {
      const tool = resolve(step.tool);
      if (!tool || (context.allowedTools && !context.allowedTools.includes(step.tool)) || ({ read: 0, write: 1, exec: 2 }[tool.scope] > { read: 0, write: 1, exec: 2 }[context.scope])) throw new Error("flow step not permitted: " + step.tool);
    }
    // Resolve every input reference before any step can mutate external state.
    function preflight(value: unknown) {
      if (!value || typeof value !== "object") return;
      if (object(value) && typeof value.$ref === "string" && value.$ref.startsWith("input.")) flowValue({ input }, value.$ref);
      Object.values(value).forEach(preflight);
    }
    flow.steps.forEach(step => preflight(step.arguments));
    await pruneFlowReceipts(owner);
    const run: FlowRun = { version: 1, id, owner, sessionId: context.sessionId!, project, flow: flow.id, fingerprint, pid: process.pid, instance: INSTANCE,
      state: "running", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), steps: [] };
    await writeFlowRun(run);
    const work = execute(run, flow, input, context, resolve).catch(() => undefined).finally(() => pending.delete(id));
    pending.set(id, work);
    return publicFlowRun(run);
  }));
}
export async function flowStatus(id: string, context: CapabilityRunContext, waitMs = 0) {
  const owner = flowOwner(principal(context));
  let run = await readFlowRun(owner, id);
  if (!run) throw new Error("flow run not found for this principal");
  if (run.state === "running" && pending.has(id) && waitMs > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([pending.get(id), new Promise(resolve => { timer = setTimeout(resolve, Math.min(25_000, waitMs)); })]);
    clearTimeout(timer); run = await readFlowRun(owner, id) ?? run;
  }
  if (run.state === "running" && run.instance !== INSTANCE) {
    let gone = false;
    try { process.kill(run.pid, 0); } catch (e) { gone = (e as NodeJS.ErrnoException).code === "ESRCH"; }
    if (gone) {
      run.state = "interrupted"; run.updatedAt = new Date().toISOString();
    }
  }
  return publicFlowRun(run);
}
