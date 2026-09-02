import os from "node:os";
import path from "node:path";
import type { Scope } from "@/lib/capabilities/scope";
import type { WorkflowOrchestrationSnapshot } from "@/lib/contracts/orchestration";
import { normalizeQuality } from "./quality";
import type {
  ActiveWorkflow,
  ActiveWorkflowBuckets,
  LearnedRecipe,
  WorkflowStep,
  WorkflowStepInput,
  WorkflowStepState,
} from "./types";

export function safeMemoryText(value: string, max: number): string {
  const out = value
    .replace(/([?&](?:token|key|secret|password|code)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(password|token|secret|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\b(?:bearer\s+)?(?:sk|pk|ghp|mso_mcp)_[a-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/\b[a-f0-9]{48,}\b/gi, "[opaque-id]")
    .trim();
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

export function sanitizeOrchestration(value: unknown): WorkflowOrchestrationSnapshot | undefined {
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
  fs_list: ["path", "includeHidden"], fs_read: ["path"], fs_search: ["query", "root"], fs_usage: ["path"],
  apps_logs: ["id"], projects_list: ["query", "limit", "offset"], project_capabilities: ["project"],
  project_function_call: ["project", "name"], project_memory_search: ["project", "query", "kind", "limit", "include_history"],
  project_memory_upsert: ["project", "kind", "source", "result", "status"], skills_list: ["project", "trust", "limit", "offset"],
  skills_read: ["name"], screen_capture: ["shell", "width", "height"], fs_write: ["path"], fs_mkdir: ["path"],
  fs_move: ["from", "to"], fs_copy: ["from", "to"], fs_delete: ["path"], apps_power: ["id", "action"],
  exec_run: ["cwd"], browser_power: ["on"],
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

export function sanitizeStoredStep(value: unknown): WorkflowStep | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<WorkflowStepInput>;
  if (typeof row.id !== "string" || typeof row.tool !== "string" ||
      !["completed", "failed", "denied", "rate_limited", "invalid_args"].includes(String(row.state)) ||
      typeof row.ts !== "string") return null;
  const durationMs = typeof row.durationMs === "number" && Number.isFinite(row.durationMs)
    ? Math.max(0, Math.min(86_400_000, Math.round(row.durationMs))) : undefined;
  return {
    id: safeMemoryText(row.id, 160), tool: safeMemoryText(row.tool, 120), state: row.state as WorkflowStepState,
    target: safeTarget(row.tool, row.target), args: safeArgs(row.tool, row.args),
    ...(durationMs != null ? { durationMs } : {}),
    ts: Number.isFinite(Date.parse(row.ts)) ? new Date(row.ts).toISOString() : new Date(0).toISOString(),
  };
}

function isActiveWorkflow(value: unknown): value is ActiveWorkflow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ActiveWorkflow>;
  return typeof row.id === "string" && typeof row.actor === "string" && typeof row.intent === "string" &&
    typeof row.startedAt === "string" && Array.isArray(row.steps);
}

export function normalizeActive(value: unknown): ActiveWorkflowBuckets {
  if (!value || typeof value !== "object") return {};
  const active: ActiveWorkflowBuckets = {};
  for (const [legacyActor, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (isActiveWorkflow(candidate)) {
      const actor = candidate.actor || legacyActor;
      (active[actor] ??= {})[candidate.id] = {
        ...candidate, scope: candidate.scope ?? "read", intent: safeMemoryText(candidate.intent, 1000),
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
        ...workflow, scope: workflow.scope ?? "read", intent: safeMemoryText(workflow.intent, 1000),
        project: workflow.project ? safeMemoryText(workflow.project, 240) || undefined : undefined,
        constraints: workflow.constraints ? safeMemoryText(workflow.constraints, 500) || undefined : undefined,
        orchestration: sanitizeOrchestration(workflow.orchestration),
        steps: workflow.steps.map(sanitizeStoredStep).filter((step): step is WorkflowStep => Boolean(step)),
      };
    }
  }
  return active;
}

export function normalizeRecipes(value: unknown): Record<string, LearnedRecipe> {
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
      ...(row as LearnedRecipe), actor: typeof row.actor === "string" && row.actor ? row.actor : "legacy:owner",
      scope, intent, project: row.project ? safeMemoryText(row.project, 240) || undefined : undefined,
      summary: safeMemoryText(typeof row.summary === "string" ? row.summary : "completed", 1200) || "completed",
      bestSteps: row.bestSteps.map(sanitizeStoredStep).filter((step): step is WorkflowStep => Boolean(step)),
      lastSteps: Array.isArray(row.lastSteps) ? row.lastSteps.map(sanitizeStoredStep).filter((step): step is WorkflowStep => Boolean(step)) : [],
      quality: normalizeQuality(row.quality), lastQuality: normalizeQuality(row.lastQuality),
      ...(row.qualityVersion === 1 ? { qualityVersion: 1 as const } : {}),
    };
  }
  return out;
}
