import "server-only";
import { audit } from "@/lib/host/audit-api";
import type { ManagedAppJob, ManagedAppJobSummary } from "./types";

// The other half of the managed-app audit trail: how an operation ENDED.
//
// The route audits the launch (`managed-app.action` + `update.uninstall` + the
// job id) and until this file nothing audited the outcome, so the log said an
// uninstall had been launched and nothing anywhere said whether it worked. The
// job records themselves are not the answer: they are pruned at 20 per app / 30
// days (job-store.ts), so after twenty-one operations the only durable trace of
// a removal was "started".
//
// Two callers, one line each, both idempotent per job id (see `audited`):
//   • job-runner.ts `finish()`, the moment a job reaches a terminal status —
//     the only place that sees EVERY ending, including one nobody is watching;
//   • the poll route, which covers a record this process did not run: a job
//     whose owner is gone reconciles to `interrupted` when it is next read, and
//     no `finish()` will ever fire for it.

const MAX_REMEMBERED = 5_000;

// On globalThis for the same reason the lock and the live-job map are: a dev
// HMR reload must not hand the route one instance and the runner another, or
// the actor stamped at the start would be lost by the time the job ends.
const g = globalThis as { __osManagedJobAudited?: Set<string>; __osManagedJobActors?: Map<string, string | null> };

/** Job ids already written. Bounded: a process that runs 5 000 jobs may re-log
 *  the oldest rather than grow without limit — the trail is append-only, so a
 *  duplicate line is cheap and a leak is not. */
const audited = (g.__osManagedJobAudited ??= new Set<string>());

/** Who asked for the operation, remembered from the request that started it.
 *  The job record has no actor field (it is written by the runner, which has no
 *  session), so the route stamps it here and the completion line can answer
 *  "by whom" as well as the launch line does. Same bound, same reasoning. */
const actors = (g.__osManagedJobActors ??= new Map<string, string | null>());

/** Structural, so one eviction rule serves both the Set and the Map. */
interface Keyed {
  size: number;
  keys(): IterableIterator<string>;
  delete(key: string): boolean;
}

function evictOldest(store: Keyed): void {
  if (store.size < MAX_REMEMBERED) return;
  const oldest = store.keys().next();
  if (!oldest.done) store.delete(oldest.value);
}

export function rememberJobActor(jobId: string, actor: string | null): void {
  evictOldest(actors);
  actors.set(jobId, actor);
}

/** True for a record that has finished — the only kind worth an outcome line. */
const isTerminal = (status: string): boolean => status === "succeeded" || status === "failed" || status === "interrupted";

/** Write the "how it ended" line for a finished job, once. Safe to call from
 *  anywhere and on any record: a job that is still running, or one already
 *  written, is a no-op. Never throws — `audit()` swallows its own failures and
 *  nothing here may break the caller (the runner's terminal path included). */
export function auditJobCompletion(record: ManagedAppJob | ManagedAppJobSummary): void {
  if (!isTerminal(record.status) || audited.has(record.id)) return;
  evictOldest(audited);
  audited.add(record.id);
  const actor = actors.get(record.id) ?? null;
  actors.delete(record.id);
  void audit({
    action: "managed-app.action",
    target: record.applicationId,
    actor,
    ok: record.status === "succeeded",
    // Same namespace as the launch line's `update.<action>`, so one grep on
    // `managed-app.action` reads as start → finish pairs joined by `jobId`.
    detail: `job.${record.kind}.${record.status}`,
    meta: {
      jobId: record.id,
      ...(record.exitCode === null ? {} : { exitCode: record.exitCode }),
      ...(record.error ? { error: record.error } : {}),
      ...(record.endedAt ? { endedAt: record.endedAt } : {}),
    },
  });
}
