import { readBoundedRegularFile } from "@/lib/host/bounded-read";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { redactText } from "./redaction";
import type { RepoMemoryKind, RepoMemoryRecord } from "./types";

export const KIND_DIR: Record<RepoMemoryKind, string> = {
  task: "tasks",
  debug: "debug",
  test: "tests",
  decision: "decisions",
  failure: "failures",
};
const LAYOUT = ["memory/tasks", "memory/debug", "memory/tests", "memory/decisions", "memory/failures", "recipes", "scripts", "evidence"] as const;
export const MAX_RECORD_BYTES = 64 * 1024;
export const MAX_RECORDS_PER_KIND = 500;

async function assertDirectoryNoSymlink(dir: string): Promise<void> {
  const stat = await fs.lstat(dir).catch(() => null);
  if (!stat) return;
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`repo memory path is not a safe directory: ${dir}`);
}

export async function projectRoot(projectPath: string): Promise<string> {
  const absolute = path.resolve(projectPath);
  const stat = await fs.lstat(absolute).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error("project path must be a real directory");
  return fs.realpath(absolute);
}

export async function existingRepoMemoryLayout(projectPath: string): Promise<string | null> {
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

export function safeArtifactId(value: string): string {
  const normalized = redactText(value, 120).replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+|\.+$/g, "");
  if (!normalized || normalized === "." || normalized === "..") throw new Error("invalid artifact id");
  return normalized;
}

export async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(body, "utf8") > MAX_RECORD_BYTES) throw new Error("repo memory record exceeds 64 KiB");
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fs.rename(tmp, file);
}

export async function readRecordFile(file: string): Promise<RepoMemoryRecord | null> {
  const raw = await readBoundedRegularFile(file, MAX_RECORD_BYTES);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RepoMemoryRecord;
    if (parsed?.schemaVersion !== 1 || typeof parsed.id !== "string" || !KIND_DIR[parsed.kind]) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function locateRecord(projectPath: string, id: string): Promise<{ file: string; record: RepoMemoryRecord } | null> {
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
