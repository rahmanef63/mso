import { listRepoMemoryRecords, upsertRepoMemory } from "./repo-memory";
import type { RepoMemoryBundle, RepoMemoryKind, RepoMemoryRecord } from "./types";

const MAX_SYNC_RECORDS = 1_000;

export async function exportRepoMemoryBundle(projectPath: string, includeHistory = true): Promise<RepoMemoryBundle> {
  const records = await listRepoMemoryRecords(projectPath, { includeHistory, limit: MAX_SYNC_RECORDS });
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), records };
}

function validRecord(value: unknown): value is RepoMemoryRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<RepoMemoryRecord>;
  return row.schemaVersion === 1
    && typeof row.id === "string"
    && ["task", "debug", "test", "decision", "failure"].includes(String(row.kind))
    && typeof row.title === "string"
    && typeof row.summary === "string"
    && typeof row.createdAt === "string";
}

export async function importRepoMemoryBundle(projectPath: string, bundle: unknown, options: { mode?: "skip-existing" | "merge" } = {}): Promise<{ imported: number; skipped: number }> {
  if (!bundle || typeof bundle !== "object") throw new Error("memory sync bundle must be an object");
  const row = bundle as Partial<RepoMemoryBundle>;
  if (row.schemaVersion !== 1 || !Array.isArray(row.records)) throw new Error("unsupported memory sync bundle");
  if (row.records.length > MAX_SYNC_RECORDS) throw new Error(`memory sync bundle exceeds ${MAX_SYNC_RECORDS} records`);
  const existing = new Set((await listRepoMemoryRecords(projectPath, { includeHistory: true, limit: MAX_SYNC_RECORDS })).map((record) => record.id));
  const mode = options.mode ?? "skip-existing";
  let imported = 0;
  let skipped = 0;
  for (const candidate of row.records) {
    if (!validRecord(candidate)) { skipped += 1; continue; }
    if (mode === "skip-existing" && existing.has(candidate.id)) { skipped += 1; continue; }
    await upsertRepoMemory(projectPath, {
      id: candidate.id,
      kind: candidate.kind as RepoMemoryKind,
      status: candidate.status,
      title: candidate.title,
      summary: candidate.summary,
      source: candidate.source,
      result: candidate.result,
      observation: candidate.observation,
      happened: candidate.happened,
      learned: candidate.learned,
      failed: candidate.failed,
      worked: candidate.worked,
      reuse: candidate.reuse,
      confidence: candidate.confidence,
      importance: candidate.importance,
      lastVerified: candidate.lastVerified,
      scope: candidate.scope,
      tags: candidate.tags,
      commit: candidate.commit,
      environment: candidate.environment,
      supersedes: candidate.supersedes,
      createdAt: candidate.createdAt,
    });
    existing.add(candidate.id);
    imported += 1;
  }
  return { imported, skipped };
}
