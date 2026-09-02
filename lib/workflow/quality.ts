import type { WorkflowQuality, WorkflowStep } from "./types";

export function emptyQuality(): WorkflowQuality {
  return { stepAttempts: 0, completedSteps: 0, failedSteps: 0, deniedSteps: 0, rateLimitedSteps: 0, invalidArgSteps: 0, retries: 0, rollbackSignals: 0, timedSteps: 0, totalStepDurationMs: 0, averageStepDurationMs: 0 };
}

export function normalizeQuality(value: unknown): WorkflowQuality {
  const base = emptyQuality();
  if (!value || typeof value !== "object") return base;
  const row = value as Partial<WorkflowQuality>;
  for (const key of Object.keys(base) as Array<keyof WorkflowQuality>) {
    const n = Number(row[key]);
    if (Number.isFinite(n) && n >= 0) base[key] = Math.round(n) as never;
  }
  base.averageStepDurationMs = base.timedSteps ? Math.round(base.totalStepDurationMs / base.timedSteps) : 0;
  return base;
}

export function summarizeWorkflowQuality(steps: WorkflowStep[]): WorkflowQuality {
  const out = emptyQuality(), pending = new Set<string>();
  for (const step of steps) {
    out.stepAttempts += 1;
    if (pending.has(step.tool)) { out.retries += 1; pending.delete(step.tool); }
    if (step.state === "completed") out.completedSteps += 1;
    else {
      pending.add(step.tool);
      if (step.state === "failed") out.failedSteps += 1;
      else if (step.state === "denied") out.deniedSteps += 1;
      else if (step.state === "rate_limited") out.rateLimitedSteps += 1;
      else out.invalidArgSteps += 1;
    }
    if (typeof step.durationMs === "number") { out.timedSteps += 1; out.totalStepDurationMs += step.durationMs; }
    if (step.state === "completed" && /\b(rollback|restore|revert)\b/i.test(JSON.stringify([step.tool, step.target, step.args]))) out.rollbackSignals += 1;
  }
  out.averageStepDurationMs = out.timedSteps ? Math.round(out.totalStepDurationMs / out.timedSteps) : 0;
  return out;
}

export function mergeQuality(a: WorkflowQuality, b: WorkflowQuality): WorkflowQuality {
  const out = emptyQuality();
  for (const key of ["stepAttempts", "completedSteps", "failedSteps", "deniedSteps", "rateLimitedSteps", "invalidArgSteps", "retries", "rollbackSignals", "timedSteps", "totalStepDurationMs"] as const)
    out[key] = a[key] + b[key];
  out.averageStepDurationMs = out.timedSteps ? Math.round(out.totalStepDurationMs / out.timedSteps) : 0;
  return out;
}

export function enrichBestSteps(best: WorkflowStep[], current: WorkflowStep[]): WorkflowStep[] {
  if (best.length !== current.length || best.some((step, i) => step.tool !== current[i]?.tool)) return best;
  return best.map((step, i) => ({ ...step, args: step.args ?? current[i]?.args, target: step.target ?? current[i]?.target }));
}

const MAX_RECIPE_STEPS = 24;
const IMPORTANT_RECIPE_TOOLS = new Set([
  "fs_write", "fs_mkdir", "fs_move", "fs_copy", "fs_delete",
  "apps_power", "browser_power", "exec_run", "screen_capture",
]);

export function compactRecipeSteps(steps: WorkflowStep[]): WorkflowStep[] {
  const unique: Array<{ index: number; step: WorkflowStep }> = [];
  const seen = new Set<string>();
  for (const [index, step] of steps.entries()) {
    if (step.state !== "completed") continue;
    const signature = JSON.stringify([step.tool, step.target ?? "", step.args ?? {}]);
    if (seen.has(signature)) continue;
    seen.add(signature);
    unique.push({ index, step });
  }
  if (unique.length <= MAX_RECIPE_STEPS) return unique.map(({ step }) => step);
  const selected = new Set<number>();
  const add = (rows: Array<{ index: number }>) => rows.forEach(({ index }) => selected.add(index));
  add(unique.slice(0, 6));
  add(unique.slice(-6));
  const important = unique.filter(({ step }) => IMPORTANT_RECIPE_TOOLS.has(step.tool));
  add(important.length <= 12 ? important : [...important.slice(0, 6), ...important.slice(-6)]);
  const remaining = MAX_RECIPE_STEPS - selected.size;
  for (let slot = 1; slot <= remaining; slot += 1) {
    const row = unique[Math.round((slot * (unique.length - 1)) / (remaining + 1))];
    if (row) selected.add(row.index);
  }
  if (selected.size < MAX_RECIPE_STEPS) {
    for (const { index } of unique) {
      selected.add(index);
      if (selected.size >= MAX_RECIPE_STEPS) break;
    }
  }
  return unique.filter(({ index }) => selected.has(index)).slice(0, MAX_RECIPE_STEPS).map(({ step }) => step);
}

export function elapsedMs(steps: WorkflowStep[], wallMs: number): number {
  const sum = steps.reduce((n, step) => n + (step.durationMs ?? 0), 0);
  return sum > 0 ? sum : wallMs;
}
