/* eslint-disable max-lines -- the atomic store, redaction policy and recipe merge must evolve together; splitting them would expose partially-safe persistence helpers. */
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { embedSkillText, hybridSemanticScore, normalizeSemanticText, SKILL_EMBEDDING_VERSION } from "./semantic";
import { allows, type Scope } from "@/lib/capabilities/scope";
import type { WorkflowOrchestrationSnapshot } from "@/lib/orchestration/types";

export type WorkflowStepState = "completed" | "failed" | "denied" | "rate_limited" | "invalid_args";

export type WorkflowStep = {
  id: string;
  tool: string;
  state: WorkflowStepState;
  target?: string;
  /** Replayable, explicitly allowlisted scalar arguments. Never raw payloads. */
  args?: Record<string, string | number | boolean>;
  durationMs?: number;
  ts: string;
};

type WorkflowStepInput = Omit<WorkflowStep, "args"> & { args?: Record<string, unknown> };

export type ActiveWorkflow = {
  id: string;
  actor: string;
  scope: Scope;
  intent: string;
  project?: string;
  constraints?: string;
  orchestration?: WorkflowOrchestrationSnapshot;
  startedAt: string;
  steps: WorkflowStep[];
};

export type WorkflowQuality = {
  stepAttempts: number; completedSteps: number; failedSteps: number; deniedSteps: number;
  rateLimitedSteps: number; invalidArgSteps: number; retries: number; rollbackSignals: number;
  timedSteps: number; totalStepDurationMs: number; averageStepDurationMs: number;
};

export type LearnedRecipe = {
  id: string;
  actor: string;
  scope: Scope;
  intent: string;
  normalizedIntent: string;
  project?: string;
  summary: string;
  embeddingVersion: string;
  embedding: number[];
  bestSteps: WorkflowStep[];
  lastSteps: WorkflowStep[];
  attempts: number;
  successes: number;
  failures: number;
  averageDurationMs: number;
  fastestDurationMs?: number;
  lastDurationMs: number;
  averageWallDurationMs: number;
  lastWallDurationMs: number;
  quality: WorkflowQuality;
  lastQuality: WorkflowQuality;
  qualityVersion?: 1;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
};

type ActiveWorkflowBuckets = Record<string, Record<string, ActiveWorkflow>>;

type SkillMemoryStore = {
  version: 3;
  active: ActiveWorkflowBuckets;
  recipes: Record<string, LearnedRecipe>;
};

export type FinishWorkflowResult = {
  workflow: ActiveWorkflow;
  recipe: LearnedRecipe;
  currentDurationMs: number;
  previousFastestMs?: number;
  improvedByMs?: number;
  improvedPct?: number;
};

export type CancelWorkflowResult = {
  workflow: ActiveWorkflow;
  reason?: string;
};

const EMPTY = (): SkillMemoryStore => ({ version: 3, active: {}, recipes: {} });
let cache: SkillMemoryStore | null = null;
let cachePath = "";
const loadInFlight = new Map<string, Promise<SkillMemoryStore>>();
let writeChain: Promise<unknown> = Promise.resolve();

function storePath(): string {
  const env = process.env.OS_SKILL_MEMORY_STORE?.trim();
  if (process.env.VITEST && !env) return path.join(os.tmpdir(), `mso-skill-memory-test-${process.pid}.json`);
  return (env || path.join(os.homedir(), ".mso", "skill-memory.json")).replace(/^~(?=$|\/)/, os.homedir());
}

function sanitizeOrchestration(value: unknown): WorkflowOrchestrationSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Partial<WorkflowOrchestrationSnapshot>;
  const risks = ["low", "medium", "high"] as const;
  const complexities = ["light", "medium", "heavy"] as const;
  const contentions = ["none", "possible", "high"] as const;
  const relevances = ["low", "medium", "high"] as const;
  const isolations = ["direct", "optional-worktree", "isolated-worktree"] as const;
  const verifications = ["targeted", "affected", "full"] as const;
  if (!risks.includes(row.risk as never) || !complexities.includes(row.complexity as never) ||
      !contentions.includes(row.contention as never) || !relevances.includes(row.memoryRelevance as never) ||
      !isolations.includes(row.isolation as never) || !verifications.includes(row.verification as never)) return undefined;
  const strings = (candidate: unknown, maxItems: number, maxLen: number) => Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === "string").map((item) => safeMemoryText(item, maxLen)).filter(Boolean).slice(0, maxItems)
    : [];
  return {
    risk: row.risk!, complexity: row.complexity!, contention: row.contention!, memoryRelevance: row.memoryRelevance!,
    isolation: row.isolation!, verification: row.verification!, reasons: strings(row.reasons, 12, 240),
    sharedResourceWarnings: strings(row.sharedResourceWarnings, 12, 240), changedPaths: strings(row.changedPaths, 80, 240),
    affectedPaths: strings(row.affectedPaths, 80, 240), reservedResources: strings(row.reservedResources, 40, 160),
    overlappingPaths: strings(row.overlappingPaths, 80, 240), overlappingResources: strings(row.overlappingResources, 40, 160),
    activeProjectWorkflows: Math.max(0, Math.min(100, Math.round(Number(row.activeProjectWorkflows) || 0))),
    conflictingWorkflowCount: Math.max(0, Math.min(100, Math.round(Number(row.conflictingWorkflowCount) || 0))),
    memoryHits: Math.max(0, Math.min(100, Math.round(Number(row.memoryHits) || 0))),
    contextEstimateTokens: Math.max(0, Math.min(1_000_000, Math.round(Number(row.contextEstimateTokens) || 0))),
    cleanupState: row.cleanupState === "pending" || row.cleanupState === "complete" ? row.cleanupState : "not-required",
    ...(typeof row.workspacePath === "string" ? { workspacePath: safeMemoryText(row.workspacePath, 240) } : {}),
    ...(typeof row.baseCommit === "string" ? { baseCommit: safeMemoryText(row.baseCommit, 80) } : {}),
    ...(typeof row.baseBranch === "string" ? { baseBranch: safeMemoryText(row.baseBranch, 160) } : {}),
    ...(typeof row.recipeUsed === "string" ? { recipeUsed: safeMemoryText(row.recipeUsed, 120) } : {}),
    createdAt: typeof row.createdAt === "string" && Number.isFinite(Date.parse(row.createdAt)) ? new Date(row.createdAt).toISOString() : new Date(0).toISOString(),
  };
}

function isActiveWorkflow(value: unknown): value is ActiveWorkflow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ActiveWorkflow>;
  return typeof row.id === "string" && typeof row.actor === "string" &&
    typeof row.intent === "string" && typeof row.startedAt === "string" && Array.isArray(row.steps);
}

/** Migrate v1's one-workflow-per-actor map and accept v2 buckets. The current
 *  production workflow must survive the deployment that introduces v2. */
function normalizeActive(value: unknown): ActiveWorkflowBuckets {
  if (!value || typeof value !== "object") return {};
  const active: ActiveWorkflowBuckets = {};
  for (const [legacyActor, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (isActiveWorkflow(candidate)) {
      const actor = candidate.actor || legacyActor;
      (active[actor] ??= {})[candidate.id] = {
        ...candidate,
        scope: candidate.scope ?? "read",
        intent: safeMemoryText(candidate.intent, 1000),
        project: candidate.project ? safeMemoryText(candidate.project, 240) || undefined : undefined,
        constraints: candidate.constraints ? safeMemoryText(candidate.constraints, 500) || undefined : undefined,
        orchestration: sanitizeOrchestration(candidate.orchestration),
        steps: candidate.steps.map(sanitizeStoredStep).filter((step): step is WorkflowStep => Boolean(step)),
      };
      continue;
    }
    if (!candidate || typeof candidate !== "object") continue;
    for (const workflow of Object.values(candidate as Record<string, unknown>)) {
      if (!isActiveWorkflow(workflow)) continue;
      const actor = workflow.actor || legacyActor;
      (active[actor] ??= {})[workflow.id] = {
        ...workflow,
        scope: workflow.scope ?? "read",
        intent: safeMemoryText(workflow.intent, 1000),
        project: workflow.project ? safeMemoryText(workflow.project, 240) || undefined : undefined,
        constraints: workflow.constraints ? safeMemoryText(workflow.constraints, 500) || undefined : undefined,
        orchestration: sanitizeOrchestration(workflow.orchestration),
        steps: workflow.steps.map(sanitizeStoredStep).filter((step): step is WorkflowStep => Boolean(step)),
      };
    }
  }
  return active;
}

function normalizeRecipes(value: unknown): Record<string, LearnedRecipe> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, LearnedRecipe> = {};
  for (const [id, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (!candidate || typeof candidate !== "object") continue;
    const row = candidate as Partial<LearnedRecipe>;
    if (typeof row.id !== "string" || typeof row.intent !== "string" || !Array.isArray(row.bestSteps)) continue;
    const scope: Scope = row.scope === "write" || row.scope === "exec" ? row.scope : "read";
    const intent = safeMemoryText(row.intent, 1000);
    if (!intent) continue;
    out[id] = {
      ...(row as LearnedRecipe),
      // Legacy global recipes remain owner-visible but are never replayed to an MCP token.
      actor: typeof row.actor === "string" && row.actor ? row.actor : "legacy:owner",
      scope,
      intent,
      project: row.project ? safeMemoryText(row.project, 240) || undefined : undefined,
      summary: safeMemoryText(typeof row.summary === "string" ? row.summary : "completed", 1200) || "completed",
      bestSteps: row.bestSteps.map(sanitizeStoredStep).filter((step): step is WorkflowStep => Boolean(step)),
      lastSteps: Array.isArray(row.lastSteps)
        ? row.lastSteps.map(sanitizeStoredStep).filter((step): step is WorkflowStep => Boolean(step))
        : [],
      quality: normalizeQuality(row.quality),
      lastQuality: normalizeQuality(row.lastQuality),
      ...(row.qualityVersion === 1 ? { qualityVersion: 1 as const } : {}),
    };
  }
  return out;
}

export type RecipeAccess =
  | { actor: string; scope: Scope; ownerView?: false }
  | { ownerView: true; actor?: never; scope?: never };

async function loadStore(): Promise<SkillMemoryStore> {
  const file = storePath();
  if (cache && cachePath === file) return cache;
  const current = loadInFlight.get(file);
  if (current) return current;

  const pending = (async () => {
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        cache = EMPTY();
        cachePath = file;
        return cache;
      }
      throw e;
    }
    const parsed = JSON.parse(raw) as { active?: unknown; recipes?: unknown };
    cache = {
      version: 3,
      active: normalizeActive(parsed.active),
      recipes: normalizeRecipes(parsed.recipes),
    };
    cachePath = file;
    return cache;
  })();
  loadInFlight.set(file, pending);
  try {
    return await pending;
  } finally {
    if (loadInFlight.get(file) === pending) loadInFlight.delete(file);
  }
}

async function persist(store: SkillMemoryStore): Promise<void> {
  const file = storePath();
  const snapshot = JSON.stringify(store, null, 2);
  const run = writeChain.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, snapshot, { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmp, file);
  });
  writeChain = run.catch(() => undefined);
  await run;
}

function actorKey(actor?: string): string {
  if (!actor) throw new Error("workflow memory needs an authenticated MCP actor");
  return actor;
}

function safeMemoryText(value: string, max: number): string {
  const out = value
    .replace(/([?&](?:token|key|secret|password|code)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(password|token|secret|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\b(?:bearer\s+)?(?:sk|pk|ghp|mso_mcp)_[a-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/\b[a-f0-9]{48,}\b/gi, "[opaque-id]")
    .trim();
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

function safeCommandShape(command: string): string | undefined {
  const programs: string[] = [];
  for (const segment of command.replace(/[\r\n]+/g, " ").split(/&&|\|\||[;|]/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    let program: string | undefined;
    for (const token of tokens) {
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
      if (!/^[A-Za-z0-9_./@+-]+$/.test(token) || token.startsWith("-")) continue;
      program = path.basename(token).slice(0, 64);
      break;
    }
    if (program && !programs.includes(program)) programs.push(program);
    if (programs.length >= 8) break;
  }
  return programs.length ? programs.join(" → ") : undefined;
}

function safeTarget(tool: string, target?: string): string | undefined {
  if (!target) return undefined;
  if (tool === "exec_run") return safeCommandShape(target);
  let out = target
    .replace(/([?&](?:token|key|secret|password|code)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(?:bearer\s+)?(?:sk|pk|ghp|mso_mcp)_[a-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/\b(password|token|secret|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]");
  out = out.replace(new RegExp(`^${os.homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "~");
  return out.length > 160 ? `${out.slice(0, 160)}…` : out;
}

const SAFE_TOOL_ARGS: Record<string, readonly string[]> = {
  fs_list: ["path", "includeHidden"],
  fs_read: ["path"],
  fs_search: ["query", "root"],
  fs_usage: ["path"],
  apps_logs: ["id"],
  projects_list: ["query", "limit", "offset"],
  project_capabilities: ["project"],
  project_function_call: ["project", "name"],
  project_memory_search: ["project", "query", "kind", "limit", "include_history"],
  project_memory_upsert: ["project", "kind", "source", "result", "status"],
  skills_list: ["project", "trust", "limit", "offset"],
  skills_read: ["name"],
  screen_capture: ["shell", "width", "height"],
  fs_write: ["path"], // content is intentionally impossible to persist
  fs_mkdir: ["path"],
  fs_move: ["from", "to"],
  fs_copy: ["from", "to"],
  fs_delete: ["path"],
  apps_power: ["id", "action"],
  exec_run: ["cwd"],
  browser_power: ["on"],
};

function safeArgs(tool: string, args?: Record<string, unknown>): Record<string, string | number | boolean> | undefined {
  if (!args) return undefined;
  const keys = SAFE_TOOL_ARGS[tool];
  if (!keys) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) out[key] = value;
    else if (typeof value === "string" && value) {
      const safe = safeMemoryText(value, 240);
      if (safe) out[key] = safe;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizeStoredStep(value: unknown): WorkflowStep | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<WorkflowStepInput>;
  if (typeof row.id !== "string" || typeof row.tool !== "string" ||
      !["completed", "failed", "denied", "rate_limited", "invalid_args"].includes(String(row.state)) ||
      typeof row.ts !== "string") return null;
  const durationMs = typeof row.durationMs === "number" && Number.isFinite(row.durationMs)
    ? Math.max(0, Math.min(86_400_000, Math.round(row.durationMs)))
    : undefined;
  return {
    id: safeMemoryText(row.id, 160),
    tool: safeMemoryText(row.tool, 120),
    state: row.state as WorkflowStepState,
    target: safeTarget(row.tool, row.target),
    args: safeArgs(row.tool, row.args),
    ...(durationMs != null ? { durationMs } : {}),
    ts: Number.isFinite(Date.parse(row.ts)) ? new Date(row.ts).toISOString() : new Date(0).toISOString(),
  };
}


function emptyQuality(): WorkflowQuality {
  return { stepAttempts: 0, completedSteps: 0, failedSteps: 0, deniedSteps: 0, rateLimitedSteps: 0, invalidArgSteps: 0, retries: 0, rollbackSignals: 0, timedSteps: 0, totalStepDurationMs: 0, averageStepDurationMs: 0 };
}
function normalizeQuality(value: unknown): WorkflowQuality {
  const base = emptyQuality(); if (!value || typeof value !== "object") return base;
  const row = value as Partial<WorkflowQuality>;
  for (const key of Object.keys(base) as Array<keyof WorkflowQuality>) {
    const n = Number(row[key]); if (Number.isFinite(n) && n >= 0) base[key] = Math.round(n) as never;
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
    else { pending.add(step.tool); if (step.state === "failed") out.failedSteps += 1; else if (step.state === "denied") out.deniedSteps += 1; else if (step.state === "rate_limited") out.rateLimitedSteps += 1; else out.invalidArgSteps += 1; }
    if (typeof step.durationMs === "number") { out.timedSteps += 1; out.totalStepDurationMs += step.durationMs; }
    if (step.state === "completed" && /\b(rollback|restore|revert)\b/i.test(JSON.stringify([step.tool, step.target, step.args]))) out.rollbackSignals += 1;
  }
  out.averageStepDurationMs = out.timedSteps ? Math.round(out.totalStepDurationMs / out.timedSteps) : 0;
  return out;
}
function mergeQuality(a: WorkflowQuality, b: WorkflowQuality): WorkflowQuality {
  const out = emptyQuality();
  for (const key of ["stepAttempts", "completedSteps", "failedSteps", "deniedSteps", "rateLimitedSteps", "invalidArgSteps", "retries", "rollbackSignals", "timedSteps", "totalStepDurationMs"] as const) out[key] = a[key] + b[key];
  out.averageStepDurationMs = out.timedSteps ? Math.round(out.totalStepDurationMs / out.timedSteps) : 0; return out;
}
function enrichBestSteps(best: WorkflowStep[], current: WorkflowStep[]): WorkflowStep[] {
  if (best.length !== current.length || best.some((step, i) => step.tool !== current[i]?.tool)) return best;
  return best.map((step, i) => ({
    ...step,
    args: step.args ?? current[i]?.args,
    target: step.target ?? current[i]?.target,
  }));
}

const MAX_RECIPE_STEPS = 24;
const IMPORTANT_RECIPE_TOOLS = new Set([
  "fs_write", "fs_mkdir", "fs_move", "fs_copy", "fs_delete",
  "apps_power", "browser_power", "exec_run", "screen_capture",
]);

/** Keep the recipe replayable without teaching the next run to repeat every
 * exploratory read. Full redacted evidence stays in lastSteps; bestSteps is a
 * compact successful route with mutations, terminal batches and final proof. */
function compactRecipeSteps(steps: WorkflowStep[]): WorkflowStep[] {
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

function elapsedMs(steps: WorkflowStep[], wallMs: number): number {
  const sum = steps.reduce((n, s) => n + (s.durationMs ?? 0), 0);
  return sum > 0 ? sum : wallMs;
}

function recipeText(intent: string, project?: string, summary?: string): string {
  return [intent, project, summary].filter(Boolean).join("\n");
}

function closestRecipe(store: SkillMemoryStore, actor: string, scope: Scope, intent: string, project?: string): LearnedRecipe | undefined {
  let best: { recipe: LearnedRecipe; score: number } | undefined;
  for (const recipe of Object.values(store.recipes)) {
    if (recipe.actor !== actor || recipe.scope !== scope) continue;
    const semantic = hybridSemanticScore(recipeText(intent, project), recipeText(recipe.intent, recipe.project));
    const exact = recipe.normalizedIntent === normalizeSemanticText(intent) ? 0.2 : 0;
    const projectBonus = project && recipe.project && normalizeSemanticText(project) === normalizeSemanticText(recipe.project) ? 0.08 : 0;
    const score = semantic + exact + projectBonus;
    if (!best || score > best.score) best = { recipe, score };
  }
  return best && best.score >= 0.48 ? best.recipe : undefined;
}

const WORKFLOW_LEASE_MS = 6 * 60 * 60_000;
const MAX_ACTIVE_PER_ACTOR = 20;
const workflowIsStale = (workflow: ActiveWorkflow): boolean =>
  Date.now() - new Date(workflow.startedAt).getTime() > WORKFLOW_LEASE_MS;

function pruneStaleWorkflows(store: SkillMemoryStore, actor: string): boolean {
  const bucket = store.active[actor];
  if (!bucket) return false;
  let changed = false;
  for (const [id, workflow] of Object.entries(bucket)) {
    if (!workflowIsStale(workflow)) continue;
    delete bucket[id];
    changed = true;
  }
  if (!Object.keys(bucket).length) delete store.active[actor];
  return changed;
}

function workflowFor(store: SkillMemoryStore, actor: string, workflowId: string): ActiveWorkflow | undefined {
  return store.active[actor]?.[workflowId];
}

function removeActiveWorkflow(store: SkillMemoryStore, actor: string, workflowId: string): void {
  const bucket = store.active[actor];
  if (!bucket) return;
  delete bucket[workflowId];
  if (!Object.keys(bucket).length) delete store.active[actor];
}

export async function startWorkflow(input: {
  actor?: string;
  scope?: Scope;
  intent: string;
  project?: string;
  constraints?: string;
  orchestration?: WorkflowOrchestrationSnapshot;
}): Promise<{ workflow: ActiveWorkflow; activeWorkflowCount: number }> {
  const actor = actorKey(input.actor);
  const scope: Scope = input.scope ?? "read";
  const intent = safeMemoryText(input.intent, 1000);
  if (!intent) throw new Error("intent must be a non-empty string");
  const store = await loadStore();
  pruneStaleWorkflows(store, actor);
  const bucket = store.active[actor] ?? {};
  if (Object.keys(bucket).length >= MAX_ACTIVE_PER_ACTOR) {
    throw new Error(`this MCP client already has ${MAX_ACTIVE_PER_ACTOR} active workflows; finish or cancel an exact workflow_id first`);
  }
  const workflow: ActiveWorkflow = {
    id: randomUUID(),
    actor,
    scope,
    intent,
    project: input.project ? safeMemoryText(input.project, 240) || undefined : undefined,
    constraints: input.constraints ? safeMemoryText(input.constraints, 500) || undefined : undefined,
    orchestration: sanitizeOrchestration(input.orchestration),
    startedAt: new Date().toISOString(),
    steps: [],
  };
  (store.active[actor] ??= {})[workflow.id] = workflow;
  await persist(store);
  return { workflow, activeWorkflowCount: Object.keys(store.active[actor]).length };
}

export type ProjectContentionSummary = {
  activeWorkflowCount: number;
  conflictingWorkflowCount: number;
  overlappingPaths: string[];
  overlappingResources: string[];
};

const normalizedProject = (value?: string) => value?.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() ?? "";
const pathScopeOverlaps = (a: string, b: string): boolean => {
  const left = a.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  const right = b.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  return Boolean(left && right && (left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)));
};

export async function summarizeProjectContention(
  project?: string, affectedPaths: string[] = [], reservedResources: string[] = [],
): Promise<ProjectContentionSummary> {
  const key = normalizedProject(project);
  if (!key) return { activeWorkflowCount: 0, conflictingWorkflowCount: 0, overlappingPaths: [], overlappingResources: [] };
  const store = await loadStore();
  let changed = false, activeWorkflowCount = 0, conflictingWorkflowCount = 0;
  const overlappingPaths = new Set<string>(), overlappingResources = new Set<string>();
  const resources = reservedResources.map((value) => value.trim().toLowerCase()).filter(Boolean);
  for (const actor of Object.keys(store.active)) {
    changed = pruneStaleWorkflows(store, actor) || changed;
    for (const workflow of Object.values(store.active[actor] ?? {})) {
      if (normalizedProject(workflow.project) !== key) continue;
      activeWorkflowCount += 1;
      let conflict = false;
      for (const requested of affectedPaths) {
        if ((workflow.orchestration?.affectedPaths ?? []).some((active) => pathScopeOverlaps(requested, active))) {
          overlappingPaths.add(requested); conflict = true;
        }
      }
      const activeResources = (workflow.orchestration?.reservedResources ?? []).map((value) => value.trim().toLowerCase());
      for (const requested of resources) {
        if (activeResources.includes(requested)) { overlappingResources.add(requested); conflict = true; }
      }
      if (conflict) conflictingWorkflowCount += 1;
    }
  }
  if (changed) await persist(store);
  return {
    activeWorkflowCount, conflictingWorkflowCount,
    overlappingPaths: [...overlappingPaths].slice(0, 80),
    overlappingResources: [...overlappingResources].slice(0, 40),
  };
}

export async function countActiveWorkflowsForProject(project?: string): Promise<number> {
  return (await summarizeProjectContention(project)).activeWorkflowCount;
}

export async function activeWorkflowForActor(actor?: string, workflowId?: string): Promise<ActiveWorkflow | null> {
  if (!actor) return null;
  const store = await loadStore();
  const changed = pruneStaleWorkflows(store, actor);
  const bucket = store.active[actor];
  const workflow = workflowId
    ? bucket?.[workflowId] ?? null
    : (bucket && Object.keys(bucket).length === 1 ? Object.values(bucket)[0] : null);
  if (changed) await persist(store);
  return workflow;
}

export async function recordWorkflowStep(actor: string | undefined, workflowId: string | undefined, step: WorkflowStepInput): Promise<void> {
  if (!actor || !workflowId) return;
  const store = await loadStore();
  const workflow = workflowFor(store, actor, workflowId);
  if (!workflow) return;
  if (["skills_search", "workflow_start", "workflow_finish", "workflow_cancel"].includes(step.tool)) return;
  const sanitized = sanitizeStoredStep(step);
  if (!sanitized) return;
  workflow.steps.push(sanitized);
  if (workflow.steps.length > 300) workflow.steps.splice(0, workflow.steps.length - 300);
  await persist(store);
}

export async function cancelWorkflow(input: {
  actor?: string;
  workflowId: string;
  reason?: string;
}): Promise<CancelWorkflowResult> {
  const actor = actorKey(input.actor);
  const store = await loadStore();
  const workflow = workflowFor(store, actor, input.workflowId);
  if (!workflow) throw new Error("workflow_id was not found for this MSO session");
  removeActiveWorkflow(store, actor, input.workflowId);
  await persist(store);
  const reason = input.reason ? safeMemoryText(input.reason, 500) || undefined : undefined;
  return { workflow, ...(reason ? { reason } : {}) };
}

export async function finishWorkflow(input: {
  actor?: string;
  recipeActor?: string;
  workflowId: string;
  summary: string;
  success: boolean;
}): Promise<FinishWorkflowResult> {
  const actor = actorKey(input.actor);
  const recipeOwner = actorKey(input.recipeActor ?? input.actor);
  const store = await loadStore();
  const workflow = workflowFor(store, actor, input.workflowId);
  if (!workflow) throw new Error("workflow_id was not found for this MSO session");

  const now = new Date();
  const wallMs = Math.max(0, now.getTime() - new Date(workflow.startedAt).getTime());
  const durationMs = elapsedMs(workflow.steps, wallMs);
  const existing = closestRecipe(store, recipeOwner, workflow.scope, workflow.intent, workflow.project);
  const previousFastestMs = existing?.fastestDurationMs;
  const summary = safeMemoryText(input.summary, 1200) || (input.success ? "completed" : "failed");
  const vector = embedSkillText(recipeText(workflow.intent, workflow.project, summary));
  const timestamp = now.toISOString();
  const compactSteps = compactRecipeSteps(workflow.steps);
  const currentQuality = summarizeWorkflowQuality(workflow.steps);

  let recipe: LearnedRecipe;
  if (existing) {
    const attempts = existing.attempts + 1;
    const successes = existing.successes + (input.success ? 1 : 0);
    const failures = existing.failures + (input.success ? 0 : 1);
    const faster = input.success && (existing.fastestDurationMs == null || durationMs < existing.fastestDurationMs);
    recipe = {
      ...existing,
      actor: recipeOwner,
      scope: workflow.scope,
      intent: workflow.intent,
      normalizedIntent: normalizeSemanticText(workflow.intent),
      project: workflow.project,
      summary,
      embeddingVersion: SKILL_EMBEDDING_VERSION,
      embedding: vector,
      lastSteps: workflow.steps,
      bestSteps: faster ? compactSteps : (input.success ? enrichBestSteps(existing.bestSteps, compactSteps) : existing.bestSteps),
      attempts,
      successes,
      failures,
      averageDurationMs: Math.round((existing.averageDurationMs * existing.attempts + durationMs) / attempts),
      fastestDurationMs: input.success ? Math.min(existing.fastestDurationMs ?? durationMs, durationMs) : existing.fastestDurationMs,
      lastDurationMs: durationMs,
      averageWallDurationMs: Math.round((existing.averageWallDurationMs * existing.attempts + wallMs) / attempts),
      lastWallDurationMs: wallMs,
      quality: mergeQuality(existing.quality, currentQuality),
      lastQuality: currentQuality,
      qualityVersion: 1,
      updatedAt: timestamp,
    };
  } else {
    recipe = {
      id: randomUUID(),
      actor: recipeOwner,
      scope: workflow.scope,
      intent: workflow.intent,
      normalizedIntent: normalizeSemanticText(workflow.intent),
      project: workflow.project,
      summary,
      embeddingVersion: SKILL_EMBEDDING_VERSION,
      embedding: vector,
      bestSteps: input.success ? compactSteps : [],
      lastSteps: workflow.steps,
      attempts: 1,
      successes: input.success ? 1 : 0,
      failures: input.success ? 0 : 1,
      averageDurationMs: durationMs,
      fastestDurationMs: input.success ? durationMs : undefined,
      lastDurationMs: durationMs,
      averageWallDurationMs: wallMs,
      lastWallDurationMs: wallMs,
      quality: currentQuality,
      lastQuality: currentQuality,
      qualityVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  store.recipes[recipe.id] = recipe;
  removeActiveWorkflow(store, actor, input.workflowId);
  const recipes = Object.values(store.recipes);
  if (recipes.length > 200) {
    recipes
      .sort((a, b) => {
        const qa = a.successes * 10 - a.failures + new Date(a.lastUsedAt ?? a.updatedAt).getTime() / 1e13;
        const qb = b.successes * 10 - b.failures + new Date(b.lastUsedAt ?? b.updatedAt).getTime() / 1e13;
        return qa - qb;
      })
      .slice(0, recipes.length - 200)
      .forEach((r) => delete store.recipes[r.id]);
  }
  await persist(store);

  const improvedByMs = input.success && previousFastestMs != null && durationMs < previousFastestMs
    ? previousFastestMs - durationMs
    : undefined;
  return {
    workflow,
    recipe,
    currentDurationMs: durationMs,
    ...(previousFastestMs != null ? { previousFastestMs } : {}),
    ...(improvedByMs != null
      ? { improvedByMs, improvedPct: Math.round((improvedByMs / previousFastestMs!) * 1000) / 10 }
      : {}),
  };
}

export async function listLearnedRecipes(access: RecipeAccess): Promise<LearnedRecipe[]> {
  const store = await loadStore();
  const recipes = Object.values(store.recipes);
  const visible = access.ownerView
    ? recipes
    : recipes.filter((recipe) => recipe.actor === access.actor && allows(access.scope, recipe.scope));
  return visible.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function markRecipeUsed(id: string, access: RecipeAccess): Promise<void> {
  const store = await loadStore();
  const recipe = store.recipes[id];
  if (!recipe) return;
  if (!access.ownerView) {
    if (recipe.actor !== access.actor || !allows(access.scope, recipe.scope)) return;
  }
  recipe.lastUsedAt = new Date().toISOString();
  await persist(store);
}

/** Test-only cache reset; harmless in production and avoids module-reset tricks. */
export function resetSkillMemoryCache(): void {
  cache = null;
  cachePath = "";
  loadInFlight.clear();
  writeChain = Promise.resolve();
}
