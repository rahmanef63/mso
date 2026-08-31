import "server-only";
import { auditJobCompletion } from "./job-audit";
import { spawnJobChild } from "./job-child";
import { pruneJobRecords, writeJobRecord } from "./job-store";
import { releaseOperation } from "./lock";
import { redact } from "./redact";
import type { ManagedAppId, ManagedAppJob, ManagedAppJobStatus, StartManagedAppJobOptions } from "./types";

// Execution half of the job layer: the record, its transcript, and keeping both
// honest while the work runs. jobs.ts owns the API and the lock; job-child.ts
// owns the process (and why waiting on `close` alone wedged the lock).
//
// THE CHILD IS IN-PROCESS — spawned by this server and killed with it. Detaching
// would not change that, and believing otherwise is the dangerous mistake here:
// `systemctl show mso.service -p KillMode -p Delegate` says `control-group`
// and `no`, so stopping or restarting the unit SIGTERMs every pid in
// /system.slice/mso.service, and `detached: true` makes a new process GROUP,
// never a new cgroup. (It is still passed — see job-child.ts: a timeout has to
// signal git/pip/npm, not just the CLI that started them.) Surviving a
// deploy for real would take `systemd-run --scope`, i.e. a second supervisor
// whose output nothing here could stream and whose exit nothing here could reap.
//
// So deploying mid-update KILLS the update. The record is the durable part: a
// job whose owner process is gone reconciles to `interrupted` (job-store.ts)
// rather than sitting at `running` forever, and the transcript up to the moment
// it died is kept. That is also why a successful backup is part of the same
// operation — a half-applied update is survivable, an invisible one is not.

export const MANAGED_APP_JOB_LOG_CAP = 256 * 1024;
const FLUSH_TICK_MS = 2_000;
const HEARTBEAT_MS = 10_000;
const MAX_LINE = 8192;
const TERMINAL: ReadonlySet<ManagedAppJobStatus> = new Set(["succeeded", "failed", "interrupted"] as const);

interface Runtime {
  record: ManagedAppJob;
  /** Trailing partial line, held back until complete so redaction always sees a
   *  whole line — a token split across two chunks would walk past the regex. */
  pending: string;
  dirty: boolean;
  writes: Promise<void>;
  /** The child's kill switch, once there is a child. Undefined while `prepare`
   *  (the mandatory backup) is still running — there is nothing to signal yet. */
  terminate?: (why: string) => void;
}

// globalThis: a dev-mode HMR reload must not orphan a running job's runtime
// (same reason lib/host/pty.ts stashes its sessions there).
const g = globalThis as { __osManagedJobs?: Map<string, Runtime>; __osManagedJobFlusher?: ReturnType<typeof setInterval> };
const live = (g.__osManagedJobs ??= new Map<string, Runtime>());

/** The in-memory record for a job this process is running — always fresher than
 *  the throttled copy on disk, and free to read, which is what makes a 2 s poll
 *  cheap. Undefined once the job is finished and flushed. */
export function liveRecord(jobId: string): ManagedAppJob | undefined {
  return live.get(jobId)?.record;
}

/** Every job this process is running, optionally for one app. The live map is
 *  populated BEFORE the record's first write (a tmp+rename that lands well
 *  after the app's lock is taken), so a listing read off the disk alone can
 *  miss the very job a refused caller was sent to look for. */
export function liveRecords(applicationId?: ManagedAppId): ManagedAppJob[] {
  const found: ManagedAppJob[] = [];
  for (const rt of live.values()) if (!applicationId || rt.record.applicationId === applicationId) found.push(rt.record);
  return found;
}

function ensureFlusher(): void {
  if (g.__osManagedJobFlusher) return;
  // One shared ticker. The heartbeat is not decoration: a job that prints
  // nothing for minutes still has to touch its record, or job-store's staleness
  // check would call it dead and free the app's lock out from under it.
  g.__osManagedJobFlusher = setInterval(() => {
    for (const rt of live.values()) {
      if (rt.dirty || Date.now() - Date.parse(rt.record.updatedAt) > HEARTBEAT_MS) void flush(rt);
    }
  }, FLUSH_TICK_MS);
  g.__osManagedJobFlusher.unref?.();
}

function flush(rt: Runtime): Promise<void> {
  rt.dirty = false;
  rt.record.updatedAt = new Date().toISOString();
  // Serialised: the ticker can fire while the previous write is still renaming.
  rt.writes = rt.writes.then(() => writeJobRecord({ ...rt.record })).catch(() => undefined);
  return rt.writes;
}

function append(rt: Runtime, text: string): void {
  const lines = (rt.pending + text).split(/\r?\n/);
  rt.pending = lines.pop() ?? "";
  // A program that never emits a newline must not buffer without bound.
  if (rt.pending.length > MAX_LINE) {
    lines.push(rt.pending);
    rt.pending = "";
  }
  if (!lines.length) return;
  const clean = `${lines.map(redact).join("\n")}\n`;
  rt.record.logOffset += clean.length;
  const merged = rt.record.log + clean;
  // Keep the TAIL: a runaway installer scrolling for half an hour must not fill
  // /home, and why a job failed is at the end, never at the beginning.
  rt.record.log = merged.length > MANAGED_APP_JOB_LOG_CAP ? merged.slice(-MANAGED_APP_JOB_LOG_CAP) : merged;
  rt.dirty = true;
}

function finish(rt: Runtime, status: ManagedAppJobStatus, exitCode: number | null, error: string | null): void {
  if (TERMINAL.has(rt.record.status)) return;
  if (rt.pending) append(rt, "\n"); // flush the last unterminated line
  rt.record.status = status;
  rt.record.exitCode = exitCode;
  rt.record.error = error ? redact(error).slice(0, 512) : null;
  rt.record.endedAt = new Date().toISOString();
  rt.dirty = true;
  // Freed HERE, in the same tick the status becomes terminal, not later in
  // run()'s finally. A poller reads the live record, so it sees `succeeded` the
  // instant this returns; releasing after an awaited flush left a window where
  // the caller had watched the job finish and was still told "another operation
  // is already running". That is the exact sequence the update UI performs —
  // poll to terminal, start the next operation — and it made this layer's own
  // test flaky (~1 run in 5).
  releaseOperation(rt.record.applicationId);
  // The one place that sees EVERY ending, including a job nobody is polling —
  // see job-audit.ts. Idempotent per job id and it never throws or rejects, so
  // it cannot interfere with the status it is reporting on.
  auditJobCompletion(rt.record);
}

/** Stop a job this process is running: the same SIGTERM its timeout would send,
 *  up to an hour early. The way OUT of an operation that is stuck holding the
 *  app's lock — without it the only cure was restarting mso, which the docs
 *  tell the operator not to do mid-update.
 *
 *  It cannot end a healthy job by accident. It needs the job's exact 24-hex id
 *  AND the app that job belongs to; it only touches a job live in THIS process;
 *  and the outcome is always `failed` ("cancelled by the operator"), never
 *  `succeeded`, so nobody can read a cancel as a finished update. A job whose
 *  child has not spawned yet — the mandatory pre-flight backup is still copying
 *  — is REFUSED rather than half-stopped: there is nothing to signal, and
 *  abandoning that copy is the exact outcome the backup exists to prevent.
 *
 *  `false` = there was no such live, cancellable job (a caller should treat that
 *  as 404/409, never as success). */
export function cancelJob(jobId: string, applicationId: ManagedAppId): boolean {
  const rt = live.get(jobId);
  if (!rt || rt.record.applicationId !== applicationId) return false;
  if (TERMINAL.has(rt.record.status) || !rt.terminate) return false;
  rt.terminate("cancelled by the operator");
  return true;
}

async function run(rt: Runtime, options: StartManagedAppJobOptions): Promise<void> {
  try {
    rt.record.status = "running";
    rt.dirty = true;
    if (options.prepare) await options.prepare((text) => append(rt, text));
    if (rt.record.argv.length) {
      await spawnJobChild(rt.record.argv, options, {
        append: (text) => append(rt, text),
        finish: (status, exitCode, error) => finish(rt, status, exitCode, error),
        register: (terminate) => {
          rt.terminate = terminate;
        },
      });
    } else finish(rt, "succeeded", null, null); // prepare-only job (an in-process restore)
  } catch (error) {
    finish(rt, "failed", null, error instanceof Error ? error.message : String(error));
  } finally {
    // finish() already freed the lock (see there). This is the idempotent
    // backstop for any path that could reach here without one.
    releaseOperation(rt.record.applicationId);
    await flush(rt); // persist the terminal record before retention reads history
    await pruneJobRecords().catch(() => undefined);
    // Keep the terminal record in the live map until retention is also complete.
    // This makes finalization observable and prevents a late prune from resolving
    // storage roots after a caller/test has already moved to another lifecycle.
    live.delete(rt.record.id);
  }
}

/** Register `record` as live, make it durable, and start the work. Resolves once
 *  the record is on disk — the work itself continues after this returns, which
 *  is the whole point: the HTTP request that started it is already gone. */
export async function launchJob(record: ManagedAppJob, options: StartManagedAppJobOptions): Promise<void> {
  const rt: Runtime = { record, pending: "", dirty: false, writes: Promise.resolve() };
  live.set(record.id, rt);
  ensureFlusher();
  await flush(rt);
  void run(rt, options);
}

export { MANAGED_APP_JOB_DEFAULT_TIMEOUT_MS } from "./job-child";
