import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { redactStrings, redactText } from "./redaction";
import type {
  AutomationScriptManifest,
  EvidenceReceipt,
  RepoMemoryKind,
  RepoMemoryLifecycle,
  RepoMemoryRecord,
  RepoMemoryResult,
  RepoMemorySearchHit,
  RepoMemorySource,
} from "./types";

const KIND_DIR: Record<RepoMemoryKind, string> = {
  task: "tasks",
  debug: "debug",
  test: "tests",
  decision: "decisions",
  failure: "failures",
};
const LAYOUT = ["memory/tasks", "memory/debug", "memory/tests", "memory/decisions", "memory/failures", "recipes", "scripts", "evidence"] as const;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_RECORDS_PER_KIND = 500;

async function assertDirectoryNoSymlink(dir: string): Promise<void> {
  const stat = await fs.lstat(dir).catch(() => null);
  if (!stat) return;
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`repo memory path is not a safe directory: ${dir}`);
}

async function projectRoot(projectPath: string): Promise<string> {
  const absolute = path.resolve(projectPath);
  const stat = await fs.lstat(absolute).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error("project path must be a real directory");
  return fs.realpath(absolute);
}

async function existingRepoMemoryLayout(projectPath: string): Promise<string | null> {
  const root = await projectRoot(projectPath);
  const agent = path.join(root, ".agent");
  const stat = await fs.lstat(agent).catch(() => null);
  if (!stat) return null;
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("repo memory .agent path is not a safe directory");
  for (const relative of LAYOUT) {
    const candidate = path.join(agent, relative);
    const nested = await fs.lstat(candidate).catch(() => null);
    if (nested && (!nested.isDirectory() || nested.isSymbolicLink())) {
      throw new Error(`repo memory path is not a safe directory: ${candidate}`);
    }
  }
  return agent;
}

export async function ensureRepoMemoryLayout(projectPath: string): Promise<string> {
  const root = await projectRoot(projectPath);
  const agent = path.join(root, ".agent");
  await assertDirectoryNoSymlink(agent);
  await fs.mkdir(agent, { recursive: true, mode: 0o700 });
  for (const relative of LAYOUT) {
    const dir = path.join(agent, relative);
    await assertDirectoryNoSymlink(dir);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  }
  return agent;
}

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

function memoryRecord(input: {
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
}): RepoMemoryRecord {
  if (!Object.prototype.hasOwnProperty.call(KIND_DIR, input.kind)) throw new Error("invalid repo memory kind");
  const now = new Date().toISOString();
  const title = redactText(input.title, 160);
  const summary = redactText(input.summary, 2400);
  if (!title || !summary) throw new Error("repo memory title and summary are required");
  const optional = (value: string | undefined, max = 2400) => value ? redactText(value, max) || undefined : undefined;
  return {
    schemaVersion: 1,
    id: input.id ? safeArtifactId(input.id) : `mem_${randomUUID()}`,
    kind: input.kind,
    status: safeStatus(input.status),
    title,
    summary,
    source: safeSource(input.source),
    ...(safeResult(input.result) ? { result: safeResult(input.result) } : {}),
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

function safeArtifactId(value: string): string {
  const normalized = redactText(value, 120).replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+|\.+$/g, "");
  if (!normalized || normalized === "." || normalized === "..") throw new Error("invalid artifact id");
  return normalized;
}

async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(body, "utf8") > MAX_RECORD_BYTES) throw new Error("repo memory record exceeds 64 KiB");
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fs.rename(tmp, file);
}

async function readRecordFile(file: string): Promise<RepoMemoryRecord | null> {
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_RECORD_BYTES) return null;
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as RepoMemoryRecord;
    if (parsed?.schemaVersion !== 1 || typeof parsed.id !== "string" || !KIND_DIR[parsed.kind]) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function locateRecord(projectPath: string, id: string): Promise<{ file: string; record: RepoMemoryRecord } | null> {
  const agent = await ensureRepoMemoryLayout(projectPath);
  for (const kind of Object.keys(KIND_DIR) as RepoMemoryKind[]) {
    const dir = path.join(agent, "memory", KIND_DIR[kind]);
    const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith(".json")).slice(0, MAX_RECORDS_PER_KIND);
    for (const name of names) {
      const file = path.join(dir, name);
      const record = await readRecordFile(file);
      if (record?.id === id) return { file, record };
    }
  }
  return null;
}

export async function upsertRepoMemory(projectPath: string, input: Parameters<typeof memoryRecord>[0]): Promise<RepoMemoryRecord> {
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

function tokens(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9._/-]{1,}/g) ?? [])].slice(0, 60);
}

function rank(record: RepoMemoryRecord, query: string, nowMs: number): RepoMemorySearchHit {
  const text = [record.title, record.summary, record.observation, record.learned, record.failed, record.worked, record.reuse, ...record.tags, ...record.scope]
    .filter(Boolean).join(" ").toLowerCase();
  const queryTokens = tokens(query);
  const matches = queryTokens.filter((token) => text.includes(token)).length;
  const lexical = queryTokens.length ? matches / queryTokens.length : 0.25;
  const verifiedAt = Date.parse(record.lastVerified ?? record.updatedAt);
  const ageDays = Math.max(0, (nowMs - (Number.isFinite(verifiedAt) ? verifiedAt : 0)) / 86_400_000);
  const freshness = Math.max(0, 1 - Math.min(ageDays, 365) / 365);
  const lifecycle = record.status === "confirmed" ? 1 : record.status === "active" ? 0.8 : record.status === "superseded" ? 0.25 : 0.15;
  const manualAuthority = record.source === "user-manual" ? (record.result === "fail" ? 1 : 0.85) : 0;
  const score = lexical * 0.45 + record.confidence * 0.14 + record.importance * 0.12 + freshness * 0.09 + lifecycle * 0.08 + manualAuthority * 0.12;
  return { record, score: Math.round(score * 10000) / 10000, ageDays: Math.round(ageDays * 10) / 10 };
}

export async function searchRepoMemory(projectPath: string, input: {
  query?: string;
  kinds?: RepoMemoryKind[];
  limit?: number;
  includeHistory?: boolean;
} = {}): Promise<RepoMemorySearchHit[]> {
  const agent = await existingRepoMemoryLayout(projectPath);
  if (!agent) return [];
  const kinds = input.kinds?.length ? input.kinds : Object.keys(KIND_DIR) as RepoMemoryKind[];
  const now = Date.now();
  const hits: RepoMemorySearchHit[] = [];
  for (const kind of kinds) {
    const dir = path.join(agent, "memory", KIND_DIR[kind]);
    const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith(".json")).slice(0, MAX_RECORDS_PER_KIND);
    for (const name of names) {
      const record = await readRecordFile(path.join(dir, name));
      if (!record) continue;
      if (!input.includeHistory && (record.status === "superseded" || record.status === "archived")) continue;
      hits.push(rank(record, input.query ?? "", now));
    }
  }
  return hits
    .filter((hit) => !input.query || hit.score >= 0.15)
    .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt))
    .slice(0, Math.max(1, Math.min(input.limit ?? 7, 20)));
}

export async function ingestManualUserTest(projectPath: string, input: {
  observation: string;
  result: Exclude<RepoMemoryResult, "unknown">;
  title?: string;
  environment?: string;
  scope?: string[];
  tags?: string[];
  commit?: string;
}): Promise<RepoMemoryRecord> {
  const observation = redactText(input.observation, 2400);
  return upsertRepoMemory(projectPath, {
    kind: "test",
    title: input.title ?? `Manual user test: ${input.result}`,
    summary: observation,
    observation,
    source: "user-manual",
    result: input.result,
    status: input.result === "pass" ? "confirmed" : "active",
    confidence: 1,
    importance: input.result === "fail" ? 0.9 : 0.7,
    lastVerified: new Date().toISOString(),
    environment: input.environment,
    scope: input.scope,
    tags: ["manual-test", input.result, ...(input.tags ?? [])],
    commit: input.commit,
    happened: observation,
    ...(input.result === "fail" ? { failed: observation } : { worked: observation }),
    reuse: input.result === "fail" ? "Use this observation as regression/debug evidence before declaring the related behavior healthy." : "Use as confirmed manual verification while environment and commit remain relevant.",
  });
}

export async function writeEvidenceReceipt(projectPath: string, receipt: EvidenceReceipt): Promise<string> {
  const agent = await ensureRepoMemoryLayout(projectPath);
  const file = path.join(agent, "evidence", `${receipt.createdAt.slice(0, 10)}-${receipt.workflow}.json`);
  await atomicWriteJson(file, receipt);
  return path.relative(await projectRoot(projectPath), file);
}

export async function writePortableRecipe(projectPath: string, recipe: unknown, id: string): Promise<string> {
  const agent = await ensureRepoMemoryLayout(projectPath);
  const file = path.join(agent, "recipes", `${safeArtifactId(id)}.json`);
  await atomicWriteJson(file, recipe);
  return path.relative(await projectRoot(projectPath), file);
}

export async function writeAutomationScript(projectPath: string, script: unknown, id: string, candidate = true): Promise<string> {
  const agent = await ensureRepoMemoryLayout(projectPath);
  const suffix = candidate ? ".candidate.json" : ".json";
  const file = path.join(agent, "scripts", `${safeArtifactId(id)}${suffix}`);
  await atomicWriteJson(file, script);
  if (!candidate) await fs.rm(path.join(agent, "scripts", `${safeArtifactId(id)}.candidate.json`), { force: true }).catch(() => undefined);
  return path.relative(await projectRoot(projectPath), file);
}

export async function readAutomationScript(projectPath: string, id: string): Promise<AutomationScriptManifest | null> {
  const agent = await existingRepoMemoryLayout(projectPath);
  if (!agent) return null;
  const safeId = safeArtifactId(id);
  for (const name of [`${safeId}.json`, `${safeId}.candidate.json`]) {
    const file = path.join(agent, "scripts", name);
    const stat = await fs.lstat(file).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_RECORD_BYTES) continue;
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8")) as AutomationScriptManifest;
      if (parsed?.schemaVersion !== 1 || parsed.id !== id || !Array.isArray(parsed.steps) || !parsed.steps.length) continue;
      if (parsed.status !== "candidate" && parsed.status !== "tested") continue;
      return parsed;
    } catch {
      continue;
    }
  }
  return null;
}
