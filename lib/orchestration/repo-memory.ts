import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { redactStrings, redactText } from "./redaction";
import {
  atomicWriteJson,
  ensureRepoMemoryLayout,
  existingRepoMemoryLayout,
  KIND_DIR,
  locateRecord,
  MAX_RECORDS_PER_KIND,
  readRecordFile,
  safeArtifactId,
} from "./repo-memory-storage";
import type {
  RepoMemoryKind,
  RepoMemoryLifecycle,
  RepoMemoryRecord,
  RepoMemoryResult,
  RepoMemorySearchHit,
  RepoMemorySource,
} from "./types";

function clamp01(value: number | undefined, fallback: number): number {
  const n = value ?? fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, Math.round(n * 1000) / 1000));
}

function safeIso(value?: string): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("memory timestamp must be ISO-8601");
  return new Date(timestamp).toISOString();
}

function safeStatus(value?: RepoMemoryLifecycle): RepoMemoryLifecycle {
  return ["active", "confirmed", "superseded", "archived"].includes(String(value)) ? value! : "active";
}

function safeResult(value?: RepoMemoryResult): RepoMemoryResult | undefined {
  return value && ["pass", "fail", "unknown"].includes(value) ? value : undefined;
}

function safeSource(value?: RepoMemorySource): RepoMemorySource {
  return value && ["agent", "system", "user-manual", "automation"].includes(value) ? value : "agent";
}

export type RepoMemoryInput = {
  id?: string;
  kind: RepoMemoryKind;
  status?: RepoMemoryLifecycle;
  title: string;
  summary: string;
  source?: RepoMemorySource;
  result?: RepoMemoryResult;
  observation?: string;
  happened?: string;
  learned?: string;
  failed?: string;
  worked?: string;
  reuse?: string;
  confidence?: number;
  importance?: number;
  lastVerified?: string;
  scope?: string[];
  tags?: string[];
  commit?: string;
  environment?: string;
  supersedes?: string[];
  createdAt?: string;
};

function memoryRecord(input: RepoMemoryInput): RepoMemoryRecord {
  if (!Object.prototype.hasOwnProperty.call(KIND_DIR, input.kind)) throw new Error("invalid repo memory kind");
  const now = new Date().toISOString();
  const title = redactText(input.title, 160);
  const summary = redactText(input.summary, 2400);
  if (!title || !summary) throw new Error("repo memory title and summary are required");
  const optional = (value: string | undefined, max = 2400) => value ? redactText(value, max) || undefined : undefined;
  const result = safeResult(input.result);
  return {
    schemaVersion: 1,
    id: input.id ? safeArtifactId(input.id) : `mem_${randomUUID()}`,
    kind: input.kind,
    status: safeStatus(input.status),
    title,
    summary,
    source: safeSource(input.source),
    ...(result ? { result } : {}),
    ...(optional(input.observation) ? { observation: optional(input.observation) } : {}),
    ...(optional(input.happened) ? { happened: optional(input.happened) } : {}),
    ...(optional(input.learned) ? { learned: optional(input.learned) } : {}),
    ...(optional(input.failed) ? { failed: optional(input.failed) } : {}),
    ...(optional(input.worked) ? { worked: optional(input.worked) } : {}),
    ...(optional(input.reuse) ? { reuse: optional(input.reuse) } : {}),
    confidence: clamp01(input.confidence, input.source === "user-manual" ? 1 : 0.8),
    importance: clamp01(input.importance, 0.5),
    ...(safeIso(input.lastVerified) ? { lastVerified: safeIso(input.lastVerified) } : {}),
    scope: redactStrings(input.scope, 40, 240),
    tags: redactStrings(input.tags, 40, 80).map((tag) => tag.toLowerCase()),
    ...(optional(input.commit, 80) ? { commit: optional(input.commit, 80) } : {}),
    ...(optional(input.environment, 400) ? { environment: optional(input.environment, 400) } : {}),
    supersedes: redactStrings(input.supersedes, 40, 120),
    createdAt: safeIso(input.createdAt) ?? now,
    updatedAt: now,
  };
}

export async function upsertRepoMemory(projectPath: string, input: RepoMemoryInput): Promise<RepoMemoryRecord> {
  const agent = await ensureRepoMemoryLayout(projectPath);
  const prior = input.id ? await locateRecord(projectPath, input.id) : null;
  const record = memoryRecord({ ...input, createdAt: prior?.record.createdAt ?? input.createdAt });
  const dir = path.join(agent, "memory", KIND_DIR[record.kind]);
  const file = prior?.file ?? path.join(dir, `${record.createdAt.slice(0, 10)}-${record.id}.json`);
  if (prior && path.dirname(prior.file) !== dir) throw new Error("repo memory kind cannot change in-place");
  await atomicWriteJson(file, record);
  for (const supersededId of record.supersedes) {
    const old = await locateRecord(projectPath, supersededId);
    if (!old || old.record.status === "superseded") continue;
    await atomicWriteJson(old.file, { ...old.record, status: "superseded", updatedAt: new Date().toISOString() });
  }
  return record;
}

export async function updateRepoMemoryLifecycle(projectPath: string, id: string, status: RepoMemoryLifecycle): Promise<RepoMemoryRecord> {
  const located = await locateRecord(projectPath, id);
  if (!located) throw new Error("repo memory record not found");
  const record = { ...located.record, status: safeStatus(status), updatedAt: new Date().toISOString() };
  await atomicWriteJson(located.file, record);
  return record;
}

export async function listRepoMemoryRecords(projectPath: string, input: {
  kinds?: RepoMemoryKind[]; includeHistory?: boolean; limit?: number;
} = {}): Promise<RepoMemoryRecord[]> {
  const agent = await existingRepoMemoryLayout(projectPath);
  if (!agent) return [];
  const kinds = input.kinds?.length ? input.kinds : Object.keys(KIND_DIR) as RepoMemoryKind[];
  const records: RepoMemoryRecord[] = [];
  for (const kind of kinds) {
    const dir = path.join(agent, "memory", KIND_DIR[kind]);
    const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith(".json")).slice(0, MAX_RECORDS_PER_KIND);
    for (const name of names) {
      const record = await readRecordFile(path.join(dir, name));
      if (!record) continue;
      if (!input.includeHistory && (record.status === "superseded" || record.status === "archived")) continue;
      records.push(record);
    }
  }
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    .slice(0, Math.max(1, Math.min(input.limit ?? 1_000, 2_500)));
}

function rank(record: RepoMemoryRecord, query: string, nowMs: number): RepoMemorySearchHit {
  const queryTokens = [...new Set(query.toLowerCase().match(/[a-z0-9][a-z0-9._/-]{1,}/g) ?? [])].slice(0, 60);
  const text = [record.title, record.summary, record.observation, record.learned, record.failed, record.worked, record.reuse, ...record.tags, ...record.scope]
    .filter(Boolean).join(" ").toLowerCase();
  const lexical = queryTokens.length ? queryTokens.filter((token) => text.includes(token)).length / queryTokens.length : 0.25;
  const verifiedAt = Date.parse(record.lastVerified ?? record.updatedAt);
  const ageDays = Math.max(0, (nowMs - (Number.isFinite(verifiedAt) ? verifiedAt : 0)) / 86_400_000);
  const freshness = Math.max(0, 1 - Math.min(ageDays, 365) / 365);
  const lifecycle = record.status === "confirmed" ? 1 : record.status === "active" ? 0.8 : record.status === "superseded" ? 0.25 : 0.15;
  const manualAuthority = record.source === "user-manual" ? (record.result === "fail" ? 1 : 0.85) : 0;
  const score = lexical * 0.45 + record.confidence * 0.14 + record.importance * 0.12 + freshness * 0.09 + lifecycle * 0.08 + manualAuthority * 0.12;
  return { record, score: Math.round(score * 10000) / 10000, ageDays: Math.round(ageDays * 10) / 10 };
}

export async function searchRepoMemory(projectPath: string, input: {
  query?: string; kinds?: RepoMemoryKind[]; limit?: number; includeHistory?: boolean;
} = {}): Promise<RepoMemorySearchHit[]> {
  const records = await listRepoMemoryRecords(projectPath, { kinds: input.kinds, includeHistory: input.includeHistory, limit: 2_500 });
  const now = Date.now();
  return records.map((record) => rank(record, input.query ?? "", now))
    .filter((hit) => !input.query || hit.score >= 0.15)
    .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt))
    .slice(0, Math.max(1, Math.min(input.limit ?? 7, 20)));
}

export async function ingestManualUserTest(projectPath: string, input: {
  observation: string; result: Exclude<RepoMemoryResult, "unknown">; title?: string; environment?: string;
  scope?: string[]; tags?: string[]; commit?: string;
}): Promise<RepoMemoryRecord> {
  const observation = redactText(input.observation, 2400);
  return upsertRepoMemory(projectPath, {
    kind: "test", title: input.title ?? `Manual user test: ${input.result}`, summary: observation, observation,
    source: "user-manual", result: input.result, status: input.result === "pass" ? "confirmed" : "active",
    confidence: 1, importance: input.result === "fail" ? 0.9 : 0.7, lastVerified: new Date().toISOString(),
    environment: input.environment, scope: input.scope, tags: ["manual-test", input.result, ...(input.tags ?? [])], commit: input.commit,
    happened: observation, ...(input.result === "fail" ? { failed: observation } : { worked: observation }),
    reuse: input.result === "fail"
      ? "Use this observation as regression/debug evidence before declaring the related behavior healthy."
      : "Use as confirmed manual verification while environment and commit remain relevant.",
  });
}
