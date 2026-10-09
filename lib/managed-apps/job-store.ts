import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ManagedAppId, ManagedAppJob } from "./types";
import { redact } from "./redact";

// Durable half of the job layer: one JSON file per job under
// ~/.mso/managed-app-jobs/ (0700 dir, 0600 files, tmp+rename), matching how
// the device store and the config store already keep state. One file per job
// rather than one index: a running job rewrites its own record every couple of
// seconds and must never read-modify-write a file another job is appending to,
// and retention is then a delete instead of a rewrite.

/** Job ids are minted here, land in a URL path AND become a filename. Anything
 *  that is not exactly 24 lowercase hex chars is refused before it is joined to
 *  a path — `../../.ssh/id_ed25519` must never survive this function. */
const JOB_ID_RE = /^[0-9a-f]{24}$/;

/** A running job rewrites its record at least this often (jobs.ts heartbeat), so
 *  a `running` record older than this whose owner is gone is not running. */
export const JOB_STALE_MS = 45_000;
const KEEP_PER_APP = 20;
const KEEP_MS = 30 * 24 * 60 * 60_000;

export function isManagedAppJobId(value: unknown): value is string {
  return typeof value === "string" && JOB_ID_RE.test(value);
}

function jobsDir(): string {
  return path.join(os.homedir(), ".mso", "managed-app-jobs");
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = it exists and belongs to someone else. Only ESRCH means gone, and
    // guessing "gone" would release the lock on a job that is still running.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Bring a record read off disk in line with reality. A job's child is killed
 *  with the server that spawned it, so a `running` record whose owner process is
 *  gone (or which stopped heart-beating) describes work that already died —
 *  leaving it `running` would strand the app's lock and lie to the operator. */
export function reconcile(record: ManagedAppJob): ManagedAppJob {
  if (record.status !== "queued" && record.status !== "running") return record;
  const fresh = Date.now() - Date.parse(record.updatedAt) < JOB_STALE_MS;
  if (fresh && pidAlive(record.serverPid)) return record;
  return {
    ...record,
    status: "interrupted",
    endedAt: new Date().toISOString(),
    error: "mso stopped while this job was running; the child process was killed with it",
  };
}

export async function writeJobRecord(record: ManagedAppJob): Promise<void> {
  const dir = jobsDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${record.id}.json`);
  // pid in the tmp name: two mso processes sharing $HOME must not collide on
  // one another's partial write.
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ ...record, log: record.log.split(/\r?\n/).map(redact).join("\n"), error: record.error ? redact(record.error) : record.error }), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, file);
}

async function parse(file: string): Promise<ManagedAppJob | null> {
  try {
    const record = JSON.parse(await fs.readFile(file, "utf8")) as ManagedAppJob;
    const shaped = isManagedAppJobId(record?.id) && typeof record.status === "string" && typeof record.updatedAt === "string";
    return shaped ? { ...record, argv: Array.isArray(record.argv) ? record.argv : [], log: typeof record.log === "string" ? record.log.split(/\r?\n/).map(redact).join("\n") : "", error: record.error ? redact(record.error) : record.error } : null;
  } catch {
    return null; // missing, half-written or hand-edited: not a job
  }
}

/** Single-record read. Persists a reconciliation so the next reader (and any
 *  other process) sees the same verdict without re-deriving it. */
export async function readJobRecord(id: string): Promise<ManagedAppJob | null> {
  if (!isManagedAppJobId(id)) return null;
  const record = await parse(path.join(jobsDir(), `${id}.json`));
  if (!record) return null;
  const reconciled = reconcile(record);
  if (reconciled !== record) await writeJobRecord(reconciled).catch(() => undefined);
  return reconciled;
}

/** Newest first. Reconciles in memory but does NOT write back — a history read
 *  stays read-only; the single-record read above is what persists the verdict. */
export async function listJobRecords(applicationId?: ManagedAppId): Promise<ManagedAppJob[]> {
  const dir = jobsDir();
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const records: ManagedAppJob[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const record = await parse(path.join(dir, name));
    if (!record) continue;
    if (applicationId && record.applicationId !== applicationId) continue;
    records.push(reconcile(record));
  }
  return records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Retention: the newest `KEEP_PER_APP` finished jobs per app, nothing older
 *  than `KEEP_MS`, and never a job that is still live. Returns files removed. */
export async function pruneJobRecords(): Promise<number> {
  const records = await listJobRecords();
  const kept = new Map<ManagedAppId, number>();
  let removed = 0;
  for (const record of records) {
    const rank = (kept.get(record.applicationId) ?? 0) + 1;
    kept.set(record.applicationId, rank);
    if (record.status === "queued" || record.status === "running") continue;
    const expired = Date.now() - Date.parse(record.startedAt) > KEEP_MS;
    if (rank <= KEEP_PER_APP && !expired) continue;
    await fs.rm(path.join(jobsDir(), `${record.id}.json`), { force: true }).catch(() => undefined);
    removed += 1;
  }
  return removed;
}
