import os from "node:os";
import path from "node:path";
import type { WorkflowCandidatePool, WorkflowReplayHandle } from "./types";

function secretSafeText(value: string, max: number): string {
  const out = value
    .replace(/([?&](?:token|key|secret|password|code)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(password|token|secret|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\b(?:bearer\s+)?(?:sk|pk|ghp|mso_mcp)_[a-z0-9_-]{8,}\b/gi, "[redacted]")
    .trim();
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

export function safeReplayPathText(value: unknown, max = 240): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const safe = secretSafeText(value, max);
  return safe && !safe.includes("[redacted]") ? safe : undefined;
}

function replayPath(value: unknown): string | undefined {
  let out = safeReplayPathText(value, 240);
  if (!out) return undefined;
  const home = os.homedir();
  if (out === home) out = "~";
  else if (out.startsWith(`${home}${path.sep}`)) out = `~${out.slice(home.length)}`;
  return out.length > 160 ? `${out.slice(0, 160)}…` : out;
}
export function safeMemoryText(value: string, max: number): string {
  const out = value
    .replace(/([?&](?:token|key|secret|password|code)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(password|token|secret|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\b(?:bearer\s+)?(?:sk|pk|ghp|mso_mcp)_[a-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/\b[a-f0-9]{48,}\b/gi, "[opaque-id]")
    .trim();
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

export function sanitizeReplayHandles(value: unknown): WorkflowReplayHandle[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: WorkflowReplayHandle[] = [];
  for (const item of value.slice(0, 6)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<WorkflowReplayHandle>;
    const kind = row.kind;
    if (kind !== "file" && kind !== "job" && kind !== "artifact" && kind !== "cursor") continue;
    const pathValue = replayPath(row.path);
    const sha256 = typeof row.sha256 === "string" && /^[a-f0-9]{64}$/i.test(row.sha256) ? row.sha256.toLowerCase() : undefined;
    const jobId = typeof row.jobId === "string" && /^[A-Za-z0-9_.:@/-]{1,160}$/.test(row.jobId) ? row.jobId : undefined;
    const artifactId = typeof row.artifactId === "string" && /^[A-Za-z0-9_.:@/-]{1,160}$/.test(row.artifactId) ? row.artifactId : undefined;
    const cursor = typeof row.cursor === "string" ? safeMemoryText(row.cursor, 512) : undefined;
    const rereadWith = row.rereadWith === "fs_read" || row.rereadWith === "read_pipeline" || row.rereadWith === "exec_job_status" ||
      row.rereadWith === "session_artifacts" || row.rereadWith === "project_candidate_search" ? row.rereadWith : undefined;
    if (kind === "file" && !pathValue) continue;
    if (kind === "job" && !jobId) continue;
    if (kind === "artifact" && !artifactId) continue;
    if (kind === "cursor" && !cursor) continue;
    out.push({
      kind,
      ...(pathValue ? { path: pathValue } : {}),
      ...(sha256 ? { sha256 } : {}),
      ...(jobId ? { jobId } : {}),
      ...(artifactId ? { artifactId } : {}),
      ...(cursor ? { cursor } : {}),
      ...(row.truncated === true ? { truncated: true } : {}),
      ...(rereadWith ? { rereadWith } : {}),
    });
  }
  return out.length ? out : undefined;
}

export function sanitizeCandidatePool(value: unknown): WorkflowCandidatePool | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Partial<WorkflowCandidatePool>;
  const unique = (candidate: unknown, maxItems: number, maxLen: number) => {
    if (!Array.isArray(candidate)) return [] as string[];
    const out: string[] = [];
    for (const item of candidate) {
      if (typeof item !== "string") continue;
      const safe = safeMemoryText(item, maxLen);
      if (!safe || safe.includes("[redacted]") || safe.includes("[opaque-id]") || out.includes(safe)) continue;
      out.push(safe);
      if (out.length >= maxItems) break;
    }
    return out;
  };
  const paths = Array.isArray(row.paths)
    ? [...new Set(row.paths
      .map((item) => safeReplayPathText(item, 240))
      .filter((item): item is string => Boolean(item))
      .map((item) => item.replace(/\\/g, "/").replace(/^\.\//, ""))
      .filter((item) => item && !path.isAbsolute(item) && !item.startsWith("../") && !item.split("/").includes("..")))]
      .slice(0, 24)
    : [];
  const skillIds = unique(row.skillIds, 16, 240);
  const connectionIds = unique(row.connectionIds, 16, 120).filter((item) => /^[A-Za-z0-9_.:@/-]+$/.test(item));
  const mcpAliases = unique(row.mcpAliases, 16, 120).filter((item) => /^[A-Za-z0-9_.:@/-]+$/.test(item));
  const revision = typeof row.revision === "string" ? safeMemoryText(row.revision, 160) : undefined;
  const cursor = typeof row.cursor === "string" ? safeMemoryText(row.cursor, 512) : undefined;
  const reusedFromRecipe = typeof row.reusedFromRecipe === "string" ? safeMemoryText(row.reusedFromRecipe, 120) : undefined;
  return {
    version: 1,
    paths,
    skillIds,
    connectionIds,
    mcpAliases,
    ...(revision ? { revision } : {}),
    ...(row.truncated === true ? { truncated: true } : {}),
    ...(cursor ? { cursor } : {}),
    ...(reusedFromRecipe ? { reusedFromRecipe } : {}),
  };
}
