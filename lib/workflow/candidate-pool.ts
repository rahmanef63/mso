import path from "node:path";
import { safeMemoryText, sanitizeCandidatePool } from "./sanitize";
import { safeReplayPathText } from "./replay-sanitize";
import type { WorkflowCandidatePool, WorkflowReplayHandle, WorkflowStepInput } from "./types";

const EMPTY = (): WorkflowCandidatePool => ({
  version: 1,
  paths: [],
  skillIds: [],
  connectionIds: [],
  mcpAliases: [],
});

function addUnique(target: string[], value: string | undefined, max: number): void {
  if (!value || target.includes(value) || target.length >= max) return;
  target.push(value);
}

function candidatePath(value: unknown, project?: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  let safe = safeReplayPathText(value, 240)?.replace(/\\/g, "/");
  if (!safe) return undefined;
  if (project && path.isAbsolute(safe) && path.isAbsolute(project)) {
    const rel = path.relative(project, safe).replace(/\\/g, "/");
    if (!rel || rel.startsWith("../") || path.isAbsolute(rel)) return undefined;
    safe = rel;
  }
  safe = safe.replace(/^\.\//, "");
  if (!safe || safe.startsWith("../") || path.isAbsolute(safe) || safe.split("/").includes("..")) return undefined;
  return safe.slice(0, 240);
}

function simpleId(value: unknown, max = 120): string | undefined {
  if (typeof value !== "string") return undefined;
  const safe = safeMemoryText(value, max);
  if (!safe || safe.includes("[redacted]") || safe.includes("[opaque-id]")) return undefined;
  if (!/^[A-Za-z0-9_.:@/-]+$/.test(safe)) return undefined;
  return safe;
}

export function mergeCandidatePools(...values: Array<WorkflowCandidatePool | undefined>): WorkflowCandidatePool | undefined {
  const out = EMPTY();
  let seen = false;
  for (const value of values) {
    const pool = sanitizeCandidatePool(value);
    if (!pool) continue;
    seen = true;
    out.revision ??= pool.revision;
    out.reusedFromRecipe ??= pool.reusedFromRecipe;
    out.truncated = out.truncated === true || pool.truncated === true || undefined;
    out.cursor ??= pool.cursor;
    for (const item of pool.paths) addUnique(out.paths, item, 24);
    for (const item of pool.skillIds) addUnique(out.skillIds, item, 16);
    for (const item of pool.connectionIds) addUnique(out.connectionIds, item, 16);
    for (const item of pool.mcpAliases) addUnique(out.mcpAliases, item, 16);
  }
  return seen ? out : undefined;
}

export function candidatePoolFromStep(
  step: WorkflowStepInput,
  project?: string,
  replay: WorkflowReplayHandle[] = [],
): WorkflowCandidatePool | undefined {
  const out = EMPTY();
  const args = step.args ?? {};
  for (const key of ["path", "from", "to", "cwd"]) addUnique(out.paths, candidatePath(args[key], project), 24);
  for (const handle of replay) {
    if (handle.kind === "file") addUnique(out.paths, candidatePath(handle.path, project), 24);
  }
  if (step.tool === "skills_read") addUnique(out.skillIds, simpleId(args.name, 240), 16);
  addUnique(out.connectionIds, simpleId(args.connection), 16);
  if (step.tool.startsWith("project_mcp_")) addUnique(out.mcpAliases, simpleId(args.server), 16);
  return out.paths.length || out.skillIds.length || out.connectionIds.length || out.mcpAliases.length ? out : undefined;
}
