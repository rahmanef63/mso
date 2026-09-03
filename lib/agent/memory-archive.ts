import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import type { AgentMemoryRecord } from "./memory-types";

const ARCHIVE_DIR_NAME = "archive-v1";
const SEGMENT_RE = /^segment-[a-f0-9]{32}\.json$/;
const MAX_ARCHIVE_SEGMENT_BYTES = 768 * 1024;
const MAX_ARCHIVE_SEGMENT_RECORDS = 400;
const MAX_ARCHIVE_RECORDS_READ = 100_000;

interface AgentMemoryArchiveSegment {
  schemaVersion: 1;
  records: AgentMemoryRecord[];
}

export interface AgentMemoryArchiveRead {
  records: AgentMemoryRecord[];
  segmentCount: number;
  bytes: number;
}

export function memoryArchiveDir(dir: string): string {
  return path.join(dir, ARCHIVE_DIR_NAME);
}

function bodyFor(records: AgentMemoryRecord[]): string {
  return JSON.stringify({ schemaVersion: 1, records } satisfies AgentMemoryArchiveSegment, null, 2);
}

async function readArchiveSegment(file: string): Promise<{ segment: AgentMemoryArchiveSegment; bytes: number }> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ARCHIVE_SEGMENT_BYTES) throw new Error("agent memory archive segment has an invalid file shape");
    if ((stat.mode & 0o077) !== 0) throw new Error("agent memory archive permissions are too broad; expected 0600");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("agent memory archive is not owned by the MSO user");
    const parsed = JSON.parse(await handle.readFile("utf8")) as AgentMemoryArchiveSegment;
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.records)) throw new Error("agent memory archive segment has an invalid schema");
    return { segment: parsed, bytes: stat.size };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function chunkRecords(records: AgentMemoryRecord[]): AgentMemoryRecord[][] {
  const chunks: AgentMemoryRecord[][] = [];
  let current: AgentMemoryRecord[] = [];
  for (const record of records) {
    const candidate = [...current, record];
    if (current.length && (candidate.length > MAX_ARCHIVE_SEGMENT_RECORDS || Buffer.byteLength(bodyFor(candidate), "utf8") > MAX_ARCHIVE_SEGMENT_BYTES)) {
      chunks.push(current);
      current = [record];
    } else {
      current = candidate;
    }
    if (Buffer.byteLength(bodyFor(current), "utf8") > MAX_ARCHIVE_SEGMENT_BYTES) throw new Error("single agent memory archive record exceeds segment limit");
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export async function archiveMemoryRecords(dir: string, records: AgentMemoryRecord[]): Promise<{ records: number; segments: number }> {
  if (!records.length) return { records: 0, segments: 0 };
  const archiveDir = memoryArchiveDir(dir);
  await fs.mkdir(archiveDir, { recursive: true, mode: 0o700 });
  await fs.chmod(archiveDir, 0o700).catch(() => undefined);
  let segments = 0;
  for (const chunk of chunkRecords(records)) {
    const body = bodyFor(chunk);
    const digest = createHash("sha256").update(body).digest("hex").slice(0, 32);
    const file = path.join(archiveDir, `segment-${digest}.json`);
    try {
      const existing = await readArchiveSegment(file);
      if (bodyFor(existing.segment.records) !== body) throw new Error("agent memory archive segment hash collision");
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const tmp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fs.chmod(tmp, 0o600);
    await fs.rename(tmp, file);
    await fs.chmod(file, 0o600);
    segments += 1;
  }
  return { records: records.length, segments };
}

export async function readMemoryArchive(dir: string): Promise<AgentMemoryArchiveRead> {
  const archiveDir = memoryArchiveDir(dir);
  let names: string[];
  try {
    names = (await fs.readdir(archiveDir)).filter((name) => SEGMENT_RE.test(name)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { records: [], segmentCount: 0, bytes: 0 };
    throw error;
  }
  const records: AgentMemoryRecord[] = [];
  let bytes = 0;
  for (const name of names) {
    const { segment, bytes: segmentBytes } = await readArchiveSegment(path.join(archiveDir, name));
    records.push(...segment.records);
    bytes += segmentBytes;
    if (records.length > MAX_ARCHIVE_RECORDS_READ) throw new Error(`agent memory archive exceeds explicit retrieval limit of ${MAX_ARCHIVE_RECORDS_READ} records`);
  }
  return { records, segmentCount: names.length, bytes };
}
