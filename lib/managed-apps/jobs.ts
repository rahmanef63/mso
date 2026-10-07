import "server-only";
import { randomBytes } from "node:crypto";
import { isManagedAppId } from "./catalog";
import { cancelJob, launchJob, liveRecord, liveRecords } from "./job-runner";
import { isManagedAppJobId, listJobRecords, readJobRecord } from "./job-store";
import { acquireOperation, releaseOperation, withManagedAppOperationLease } from "./lock";
import { MANAGED_APP_JOB_KINDS } from "./types";
import type { ManagedAppId, ManagedAppJob, ManagedAppJobSummary, StartManagedAppJobOptions } from "./types";

// The long managed-app operations (update, uninstall, restore) are JOBS: the
// POST starts one and returns an id, the client polls. A route handler cannot
// hold an `openclaw update` open — its own default step timeout is 1800 s and
// it restarts services on the way out — and an in-memory promise would vanish
// at the next deploy with nothing on disk to show for it. job-runner.ts runs
// the child (and documents what a mid-update deploy does to it); job-store.ts
// keeps the record; this file is the API and the lock.

const MAX_ARGV = 32;
const MAX_ARG_LEN = 512;
/** Random per-process id, stashed so an HMR reload keeps the same identity. A
 *  record naming a runner other than this one was started by a process that no
 *  longer exists — and its child died with it. */
const RUNNER_ID = ((globalThis as { __osManagedJobRunner?: string }).__osManagedJobRunner ??= randomBytes(6).toString("hex"));
/** Any C0/C1 control character, as a Unicode property escape so no literal
 *  control byte has to be typed into this file. */
const CONTROL_CHAR = /\p{Cc}/u;

/** Does this record stand in the way of a new job?
 *
 *  Within THIS process a job is either live or over: `launchJob` puts it in the
 *  live map BEFORE its first write and removes it only after its terminal one.
 *  So one of ours that is not live has finished — whatever the file says. That
 *  matters because the file can lag: `listJobRecords` reads the disk, and the
 *  terminal flush can land in the gap between that read and this check, leaving
 *  a `running` snapshot of a job the caller has already watched finish. It made
 *  "poll to done, start the next operation" — the update UI's whole flow —
 *  fail intermittently with a lock error nobody was holding.
 *
 *  A record from ANOTHER runner is judged on its contents, which is the entire
 *  reason the records are consulted at all. */
function blocking(record: ManagedAppJob): boolean {
  const live = liveRecord(record.id);
  if (live) return live.status === "queued" || live.status === "running";
  if (record.runnerId === RUNNER_ID) return false;
  return record.status === "queued" || record.status === "running";
}

function normaliseArgv(argv: readonly string[] | undefined): string[] {
  const list = [...(argv ?? [])];
  if (list.length > MAX_ARGV) throw new Error("managed application job argv is too long");
  for (const arg of list) {
    // No shell is ever involved, so this is not quoting — it is a tripwire on
    // the CALLER. Every user-supplied channel/tag/branch has to be allowlisted
    // into a plain argv element before it arrives here; a control character in
    // one means it was not, and the job is refused rather than run.
    if (typeof arg !== "string" || !arg || arg.length > MAX_ARG_LEN || CONTROL_CHAR.test(arg)) {
      throw new Error("managed application job argument is not allowed");
    }
  }
  return list;
}

/** Start a job and return its record immediately: the work outlives the request
 *  that started it (though not this server process — see job-runner.ts).
 *  Throws when the app already has an operation in flight, which the route maps
 *  to 409 like every other managed-app conflict. */
export async function startManagedAppJob(options: StartManagedAppJobOptions): Promise<ManagedAppJob> {
  const { applicationId, kind } = options;
  if (!isManagedAppId(applicationId)) throw new Error("unknown managed application");
  if (!(MANAGED_APP_JOB_KINDS as readonly string[]).includes(kind)) throw new Error("unsupported managed application job");
  const argv = normaliseArgv(options.argv);
  return withManagedAppOperationLease(applicationId, async () => {
    if ((await listJobRecords(applicationId)).some(blocking)) throw new Error("another operation is already running");
    if (!acquireOperation(applicationId, kind)) throw new Error("another operation is already running");
    const now = new Date().toISOString();
    const record: ManagedAppJob = {
      id: randomBytes(12).toString("hex"),
      applicationId,
      kind,
      argv,
      status: "queued",
      startedAt: now,
      endedAt: null,
      exitCode: null,
      error: null,
      log: "",
      logOffset: 0,
      runnerId: RUNNER_ID,
      serverPid: process.pid,
      updatedAt: now,
    };
    try {
      await launchJob(record, options); // return only after the cross-process claim is durable
    } catch (error) {
      releaseOperation(applicationId);
      throw error;
    }
    return snapshot(record, 0);
  });
}

/** Poll read. `since` = the previous reply's `logOffset`, so `log` holds only
 *  what is new; omit it for the whole (capped) transcript. A live job is served
 *  from memory — polling every couple of seconds costs no disk read. */
export async function readManagedAppJob(jobId: string, since = 0): Promise<ManagedAppJob | null> {
  if (!isManagedAppJobId(jobId)) return null;
  const record = liveRecord(jobId) ?? (await readJobRecord(jobId));
  return record ? snapshot(record, since) : null;
}

/** Stop a running job's child, freeing the app's lock without restarting
 *  mso. `false` = there is no live, cancellable job with that id for that app
 *  — an unknown id, one that already finished, one belonging to another app, or
 *  one still inside its mandatory pre-flight backup. See job-runner's
 *  `cancelJob` for why each of those refuses. Callers must not report `false` as
 *  a successful cancel. */
export function cancelManagedAppJob(jobId: string, applicationId: string): boolean {
  if (!isManagedAppJobId(jobId) || !isManagedAppId(applicationId)) return false;
  return cancelJob(jobId, applicationId);
}

/** History, newest first, without the transcripts.
 *
 *  Disk PLUS whatever this process is running, because the two disagree for the
 *  first few milliseconds of every job and that is precisely the window this
 *  endpoint is consulted in: a second submit is refused the instant the winner
 *  takes the lock, which is before the winner's record has been written, and
 *  the client asks here for the job to ADOPT rather than render the refusal as
 *  a failed update. Reading the disk alone answered "no job is running" while
 *  one demonstrably was. Same reasoning as `blocking()` above — inside this
 *  process the live map is the fresher truth. */
export async function listManagedAppJobs(applicationId?: ManagedAppId, limit = 20): Promise<ManagedAppJobSummary[]> {
  const onDisk = await listJobRecords(applicationId);
  const known = new Set(onDisk.map((record) => record.id));
  const records = [...liveRecords(applicationId).filter((record) => !known.has(record.id)), ...onDisk].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
  return records.slice(0, Math.min(Math.max(limit, 1), 100)).map((record) => summarise(liveRecord(record.id) ?? record));
}

function snapshot(record: ManagedAppJob, since: number): ManagedAppJob {
  const dropped = record.logOffset - record.log.length; // chars the cap already ate
  const from = Math.min(Math.max(since - dropped, 0), record.log.length);
  return { ...record, argv: [...record.argv], log: record.log.slice(from) };
}

function summarise({ log, ...rest }: ManagedAppJob): ManagedAppJobSummary {
  return rest;
}

export { isManagedAppJobId, pruneJobRecords as pruneManagedAppJobs } from "./job-store";
export { MANAGED_APP_JOB_DEFAULT_TIMEOUT_MS, MANAGED_APP_JOB_LOG_CAP } from "./job-runner";
export type { StartManagedAppJobOptions } from "./types";
