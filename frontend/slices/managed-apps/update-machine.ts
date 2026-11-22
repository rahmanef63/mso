// Pure job state machine. No fetch, no React: the polling loop feeds it events
// and the panel renders what comes out, so every transition is testable in node.
import type { JobView } from "./update-api";

export type JobPhase = "idle" | "starting" | "running" | "succeeded" | "failed" | "interrupted";

/** The client keeps far less than the server's 256 KB tail — a window shows the
 *  end of the run, and an unbounded string in state is a leak on a 30 min job. */
export const CLIENT_LOG_CAP = 64_000;
export const POLL_INTERVAL_MS = 2_000;
/** Below this, a failed poll is a blip; at or above it, say so on screen. */
const QUIET_POLLS_BEFORE_WARNING = 3;

export interface JobState {
  phase: JobPhase;
  /** What the operator asked for ("update", "dry run", "restore", "uninstall"). */
  kind: string | null;
  jobId: string | null;
  log: string;
  /** Next `since` cursor to send. */
  cursor: number;
  error: string | null;
  /** Transient: the job is fine, our polling is not. */
  warning: string | null;
  misses: number;
  exitCode: number | null;
  startedAt: string | null;
  endedAt: string | null;
}

export const IDLE_JOB: JobState = {
  phase: "idle",
  kind: null,
  jobId: null,
  log: "",
  cursor: 0,
  error: null,
  warning: null,
  misses: 0,
  exitCode: null,
  startedAt: null,
  endedAt: null,
};

export type JobEvent =
  | { type: "start"; kind: string }
  | { type: "started"; jobId: string }
  /** A job already running when the window opened (or reopened). */
  | { type: "adopt"; job: JobView }
  | { type: "polled"; job: JobView }
  | { type: "poll-failed"; message: string }
  | { type: "vanished" }
  /** The POST itself was refused — nothing ever spawned. */
  | { type: "rejected"; message: string }
  | { type: "reset" };

export function phaseOf(status: JobView["status"]): JobPhase {
  return status === "queued" || status === "running" ? "running" : status;
}

export const isActive = (phase: JobPhase): boolean => phase === "starting" || phase === "running";
export const isTerminal = (phase: JobPhase): boolean =>
  phase === "succeeded" || phase === "failed" || phase === "interrupted";

// `logOffset` counts every char ever appended while `log` is only the tail, so
// their difference is where this chunk really starts. If that is past our
// cursor the server's cap dropped bytes we never read — say so instead of
// silently splicing two ends of the output together.
function appendLog(state: JobState, job: JobView): { log: string; cursor: number } {
  const chunk = job.log;
  const start = job.logOffset > 0 ? job.logOffset - chunk.length : state.cursor;
  const gap = start > state.cursor ? start - state.cursor : 0;
  const merged = state.log + (gap ? `\n… ${gap} characters dropped by the log cap …\n` : "") + chunk;
  return {
    log: merged.length > CLIENT_LOG_CAP ? merged.slice(merged.length - CLIENT_LOG_CAP) : merged,
    cursor: job.logOffset > 0 ? job.logOffset : state.cursor + chunk.length,
  };
}

function fromJob(state: JobState, job: JobView): JobState {
  return {
    ...state,
    ...appendLog(state, job),
    phase: phaseOf(job.status),
    jobId: job.id,
    kind: state.kind ?? job.kind,
    exitCode: job.exitCode,
    error: job.error,
    warning: null,
    misses: 0,
    startedAt: job.startedAt ?? state.startedAt,
    endedAt: job.endedAt,
  };
}

export function jobReducer(state: JobState, event: JobEvent): JobState {
  switch (event.type) {
    case "start":
      return { ...IDLE_JOB, phase: "starting", kind: event.kind };
    case "started":
      return { ...state, phase: "running", jobId: event.jobId };
    case "adopt": {
      // `GET /jobs` answers with SUMMARIES: a real `logOffset`, but no `log` at
      // all (a history list must not be 20 × 256 KB). Taking that offset as the
      // cursor would skip the entire transcript so far AND announce it as
      // "dropped by the log cap" — output the cap never touched. Adopt the
      // identity only and leave the cursor at 0; the first poll then asks for
      // `since=0` and gets the whole tail the server still holds, with the gap
      // marker reporting what was really lost.
      const seeded = event.job.log ? event.job : { ...event.job, logOffset: 0 };
      return fromJob({ ...IDLE_JOB, kind: event.job.kind }, seeded);
    }
    case "polled":
      return fromJob(state, event.job);
    case "poll-failed": {
      const misses = state.misses + 1;
      return {
        ...state,
        misses,
        warning: misses >= QUIET_POLLS_BEFORE_WARNING
          ? `Lost contact with the server (${misses} attempts): ${event.message}. The job may still be running on the host.`
          : null,
      };
    }
    case "vanished":
      return { ...state, phase: "failed", error: "the job record is gone: it was pruned, or never written" };
    case "rejected":
      return { ...state, phase: "failed", error: event.message, exitCode: null };
    case "reset":
      return IDLE_JOB;
    default:
      return state;
  }
}

/** One line for the aria-live region. Terminal wording is deliberately blunt:
 *  an interrupted job is NOT a spinner and NOT a failure the app reported. */
export function statusLine(state: JobState): string {
  const label = state.kind ?? "job";
  switch (state.phase) {
    case "idle":
      return "No update job is running.";
    case "starting":
      return `Starting ${label}…`;
    case "running":
      return `${label} is running. This can take several minutes and restarts the service.`;
    case "succeeded":
      return `${label} finished successfully.`;
    case "failed":
      return `${label} failed${state.error ? `: ${state.error}` : ""}.`;
    case "interrupted":
      return `${label} was interrupted: the cockpit restarted while it ran, so nothing watched it finish. It may be half-applied: check the version below before retrying.`;
  }
}
