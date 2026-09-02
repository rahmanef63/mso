import { listRepoMemoryRecords } from "./repo-memory";
import type { RepoMemoryRecord, RepoMemoryRelation, RepoMemoryTimelineEvent } from "./types";

function tokenSet(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9._/-]{1,}/g) ?? []);
}

function overlapRatio(a: Iterable<string>, b: Iterable<string>): number {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const value of left) if (right.has(value)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

function relation(current: RepoMemoryRecord, target: RepoMemoryRecord): RepoMemoryRelation | null {
  if (current.supersedes.includes(target.id)) {
    return { type: "supersedes", targetId: target.id, targetKind: target.kind, title: target.title, score: 1, reasons: ["explicit supersedes link"] };
  }
  if (target.supersedes.includes(current.id)) {
    return { type: "superseded-by", targetId: target.id, targetKind: target.kind, title: target.title, score: 1, reasons: ["explicit superseded-by link"] };
  }
  const scope = overlapRatio(current.scope, target.scope);
  const tags = overlapRatio(current.tags, target.tags);
  const currentText = tokenSet(`${current.title} ${current.summary} ${current.observation ?? ""}`);
  const targetText = tokenSet(`${target.title} ${target.summary} ${target.observation ?? ""}`);
  const lexical = overlapRatio(currentText, targetText);
  const resultConflict = Boolean(current.result && target.result && current.result !== "unknown" && target.result !== "unknown" && current.result !== target.result);
  if (resultConflict && (scope >= 0.25 || tags >= 0.25) && current.kind === target.kind) {
    return {
      type: "conflicts-with",
      targetId: target.id,
      targetKind: target.kind,
      title: target.title,
      score: Math.round((0.75 + Math.max(scope, tags) * 0.25) * 1000) / 1000,
      reasons: ["same memory kind", "conflicting pass/fail result", ...(scope ? ["shared scope"] : []), ...(tags ? ["shared tags"] : [])],
    };
  }
  const sameKind = current.kind === target.kind ? 0.08 : 0;
  const score = scope * 0.38 + tags * 0.3 + lexical * 0.24 + sameKind;
  if (score < 0.14) return null;
  return {
    type: "related",
    targetId: target.id,
    targetKind: target.kind,
    title: target.title,
    score: Math.round(Math.min(1, score) * 1000) / 1000,
    reasons: [scope ? "shared scope" : "", tags ? "shared tags" : "", lexical ? "shared terms" : "", sameKind ? "same memory kind" : ""].filter(Boolean),
  };
}

export async function relatedRepoMemory(projectPath: string, memoryId: string, limit = 6): Promise<{ record: RepoMemoryRecord; relations: RepoMemoryRelation[] } | null> {
  const records = await listRepoMemoryRecords(projectPath, { includeHistory: true, limit: 2_500 });
  const record = records.find((candidate) => candidate.id === memoryId);
  if (!record) return null;
  const relations = records
    .filter((candidate) => candidate.id !== record.id)
    .map((candidate) => relation(record, candidate))
    .filter((candidate): candidate is RepoMemoryRelation => Boolean(candidate))
    .sort((a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId))
    .slice(0, Math.max(1, Math.min(limit, 20)));
  return { record, relations };
}

function matchesQuery(record: RepoMemoryRecord, query: string): boolean {
  const wanted = tokenSet(query);
  if (!wanted.size) return true;
  const haystack = tokenSet(`${record.title} ${record.summary} ${record.observation ?? ""} ${record.tags.join(" ")} ${record.scope.join(" ")}`);
  for (const token of wanted) if (haystack.has(token)) return true;
  return false;
}

export async function repoMemoryTimeline(projectPath: string, input: { query?: string; includeHistory?: boolean; limit?: number } = {}): Promise<RepoMemoryTimelineEvent[]> {
  const records = await listRepoMemoryRecords(projectPath, { includeHistory: input.includeHistory, limit: 2_500 });
  return records
    .filter((record) => !input.query || matchesQuery(record, input.query))
    .sort((a, b) => (b.lastVerified ?? b.updatedAt).localeCompare(a.lastVerified ?? a.updatedAt))
    .slice(0, Math.max(1, Math.min(input.limit ?? 12, 50)))
    .map((record) => ({
      id: record.id,
      kind: record.kind,
      status: record.status,
      source: record.source,
      ...(record.result ? { result: record.result } : {}),
      title: record.title,
      summary: record.summary.slice(0, 600),
      at: record.lastVerified ?? record.updatedAt,
      ...(record.commit ? { commit: record.commit } : {}),
      ...(record.environment ? { environment: record.environment } : {}),
    }));
}
