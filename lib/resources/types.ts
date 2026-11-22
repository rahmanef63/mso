/**
 * Per-slice resource accounting contracts.
 *
 * Two separate ideas live here, and keeping them apart is the whole point:
 *   budget  - a declared ceiling, from a cited code constant or an explicit policy
 *   actual  - what the slice really consumed, from an instrumented call
 *
 * A budget is never a measurement and a measurement is never a budget. Every field
 * carries provenance so a reader can tell which one they are looking at.
 */

/** How a declared number came to exist. Never conflate these in a report. */
export type ProvenanceKind =
  /** A constant, timeout or limiter that already exists in this repository. */
  | "cited"
  /** Arithmetic over cited constants (for example 60_000 / poll interval). */
  | "derived"
  /** A stated MSO policy decision. Not measured, not derived from code. */
  | "policy"
  /** No ceiling exists in code. Reported as unknown, never as zero or free. */
  | "unmeasured";

export type Provenance = {
  kind: ProvenanceKind;
  /** Repository-relative source file, or the declaring module for a policy. */
  file: string;
  /** 1-based line in that file. 0 when the claim is a grep/absence claim. */
  line: number;
  /** Why this number, with units where relevant. */
  note: string;
};

export type SliceBudget = {
  /** CPU-time ceiling per wall-clock minute, in milliseconds. */
  cpuMsPerMinute: number | null;
  /** Resident memory ceiling, in MiB. */
  memoryMiB: number | null;
  /** Concurrent in-flight task slots. */
  concurrentTasks: number | null;
  /** External or capability calls per rolling minute. */
  externalCallsPerMinute: number | null;
  /** Whether the slice may start a worker (exec, exec job, PTY, subagent). */
  maySpawnWorker: boolean | null;
};

export type SliceBudgetProvenance = Record<keyof SliceBudget, Provenance>;

export type SliceBudgetEntry = {
  /** Slice directory name under frontend/slices, or a lib domain name. */
  slice: string;
  budget: SliceBudget;
  provenance: SliceBudgetProvenance;
  /** One line of why this slice has the shape it does. */
  rationale: string;
};

/** One instrumented capability call. Measured; never synthesised. */
export type SliceUsageSample = {
  /** Registry slice key, or null when the call could not be attributed. */
  slice: string | null;
  tool: string;
  actor?: string;
  /** Wall time of the call, milliseconds. */
  wallMs: number;
  /**
   * CPU time consumed by the whole Node process across this call, milliseconds.
   * Measured with process.cpuUsage() around the call, so it includes concurrent
   * work from other slices sharing the process. Reported as process-scoped, not
   * per-slice-exclusive.
   */
  cpuMs: number;
  /** Size of the result payload handed back to the caller, in bytes. Null when the
   * payload could not be serialized, which is recorded rather than assumed zero. */
  resultBytes: number | null;
  /** In-flight calls for the same slice at this call's start, including this one. */
  concurrent: number;
  /** Epoch milliseconds. */
  at: number;
};
