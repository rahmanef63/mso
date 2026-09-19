import type { WorkflowReplayHandle } from "./types";

const MAX_HANDLES = 6;
const MAX_NODES = 96;

function text(value: unknown, max = 512): string | undefined {
  if (typeof value !== "string") return undefined;
  const out = value.trim();
  return out ? out.slice(0, max) : undefined;
}

function pushUnique(out: WorkflowReplayHandle[], handle: WorkflowReplayHandle): void {
  const key = JSON.stringify(handle);
  if (!out.some((row) => JSON.stringify(row) === key)) out.push(handle);
}

export function replayHandlesFromResult(result: unknown): WorkflowReplayHandle[] {
  const out: WorkflowReplayHandle[] = [];
  let nodes = 0;

  const visit = (value: unknown, depth: number): void => {
    if (out.length >= MAX_HANDLES || nodes >= MAX_NODES || depth > 3 || value == null) return;
    nodes += 1;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 16)) visit(item, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    const path = text(row.path, 512);
    const sha256 = text(row.sha256, 80);
    const cursor = text(row.cursor, 512) ?? text(row.nextCursor, 512);
    const truncated = row.truncated === true || row.msoTruncated === true;

    if (path) {
      pushUnique(out, {
        kind: "file",
        path,
        ...(sha256 && /^[a-f0-9]{64}$/i.test(sha256) ? { sha256: sha256.toLowerCase() } : {}),
        ...(truncated ? { truncated: true } : {}),
        ...(cursor ? { cursor } : {}),
        rereadWith: "read_pipeline",
      });
    }

    const jobId = text(row.job_id, 160) ?? text(row.jobId, 160);
    if (jobId) pushUnique(out, { kind: "job", jobId, rereadWith: "exec_job_status" });

    const artifactId = text(row.artifact_id, 160) ?? text(row.artifactId, 160);
    if (artifactId) pushUnique(out, { kind: "artifact", artifactId, rereadWith: "session_artifacts" });

    if (!path && cursor) {
      pushUnique(out, {
        kind: "cursor",
        cursor,
        ...(truncated ? { truncated: true } : {}),
        rereadWith: "project_candidate_search",
      });
    }

    for (const [key, child] of Object.entries(row)) {
      if (["content", "stdout", "stderr", "text", "body", "data", "buffer", "bytes"].includes(key)) continue;
      if (typeof child === "object" && child !== null) visit(child, depth + 1);
      if (out.length >= MAX_HANDLES || nodes >= MAX_NODES) break;
    }
  };

  visit(result, 0);
  return out.slice(0, MAX_HANDLES);
}
