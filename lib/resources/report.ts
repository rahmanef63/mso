import type { SliceBudget, SliceBudgetProvenance, Provenance } from "./types";
import type { SliceUsageAggregate } from "./ledger";
import { REGISTRY } from "./registry-data";

/**
 * Budget vs actual, built from the registry and the ledger.
 *
 * Every field states its own evidence class, because this report's whole job is to
 * not launder an estimate as a fact:
 *   measured       - read off the ledger (a real call happened)
 *   estimated      - arithmetic over measured values, to a stated window
 *   declared-only  - the registry states it and nothing measures it
 *   undeclared     - the registry says "no ceiling known"
 *   not-instrumented - the value exists but MSO does not measure it yet
 */

export type EvidenceClass = "measured" | "estimated" | "declared-only" | "undeclared" | "not-instrumented" | "under-sampled";

export type BudgetFieldReport = {
  field: keyof SliceBudget;
  budget: number | boolean | null;
  actual: number | boolean | null;
  evidence: EvidenceClass;
  /** over: actual exceeds a declared ceiling. unknown: nothing to compare. */
  status: "over" | "within" | "unknown";
  provenance: Provenance;
};

export type SliceResourceReport = {
  slice: string;
  /** false when the slice exists on disk but has no registry entry. */
  accounted: boolean;
  rationale: string;
  /** Observed window for the measured values below, milliseconds. */
  windowMs: number;
  calls: number;
  fields: BudgetFieldReport[];
};

export type UnaccountedUsage = {
  calls: number;
  wallMs: number;
  cpuMs: number;
};

export type SliceResourceReportSet = {
  /** ISO timestamp of the report, so a reader knows how stale it is. */
  generatedAt: string;
  /** Ledger capacity in samples; the report covers at most this many calls. */
  bufferCapacity: number;
  /** Samples evicted before this report because the buffer was full. */
  droppedSamples: number;
  slices: SliceResourceReport[];
  /** Real slice directories with no registry entry, worst first. */
  unaccountedSlices: string[];
  /** Capability calls no slice provably owns. Never folded into a slice total. */
  unaccounted: UnaccountedUsage;
};

/**
 * Per-minute projection of a measured total.
 *
 * ESTIMATE, not a measurement: a window shorter than a minute is scaled linearly,
 * which assumes the rate held for the whole minute. Report it as such.
 *
 * A window below `MIN_PROJECTION_MS` returns null instead of a number. Dividing one
 * fresh call's few milliseconds of CPU by a millisecond-wide window produces a figure
 * in the hundreds of thousands per minute, which would render as "over budget" for a
 * slice that has done nothing wrong. A rate needs enough elapsed time to mean
 * anything, and refusing to state one is more honest than stating a spike.
 */
export const MIN_PROJECTION_MS = 10_000;

export function perMinute(total: number, windowMs: number): number | null {
  if (!Number.isFinite(total) || !Number.isFinite(windowMs) || windowMs <= 0) return null;
  if (windowMs < MIN_PROJECTION_MS) return null;
  return Math.round((total * 60_000) / windowMs);
}

function compare(actual: number | boolean | null, budget: number | boolean | null): BudgetFieldReport["status"] {
  if (actual === null || budget === null) return "unknown";
  if (typeof actual === "boolean" || typeof budget === "boolean") return actual === budget ? "within" : "over";
  return actual > budget ? "over" : "within";
}

function field(
  name: keyof SliceBudget,
  budget: number | boolean | null,
  actual: number | boolean | null,
  evidence: EvidenceClass,
  provenance: Provenance,
): BudgetFieldReport {
  return { field: name, budget, actual, evidence, status: compare(actual, budget), provenance };
}

/** Build one slice's budget-vs-actual row from a ledger aggregate. */
export function buildSliceReport(
  slice: string,
  budget: SliceBudget,
  provenance: SliceBudgetProvenance,
  rationale: string,
  usage: SliceUsageAggregate | undefined,
  now = Date.now(),
): SliceResourceReport {
  const windowMs = usage ? Math.max(1, now - usage.firstAt + 1) : 0;
  const calls = usage?.calls ?? 0;
  const measuredCalls = usage !== undefined;
  // A rate needs enough elapsed time to mean anything. Below the floor the value is
  // reported as under-sampled (null) instead of as a spike that reads "over budget".
  const rateable = measuredCalls && windowMs >= MIN_PROJECTION_MS;
  const rateEvidence: EvidenceClass = !measuredCalls ? "not-instrumented" : rateable ? "estimated" : "under-sampled";

  return {
    slice,
    accounted: true,
    rationale,
    windowMs,
    calls,
    fields: [
      field(
        "cpuMsPerMinute",
        budget.cpuMsPerMinute,
        rateable ? perMinute(usage.cpuMs, windowMs) : null,
        rateEvidence,
        provenance.cpuMsPerMinute,
      ),
      // Memory per slice is NOT instrumented anywhere in MSO. Reporting a payload
      // size here would be a different measurement wearing this field's name.
      field("memoryMiB", budget.memoryMiB, null, "not-instrumented", provenance.memoryMiB),
      field(
        "concurrentTasks",
        budget.concurrentTasks,
        measuredCalls ? usage.peakConcurrency : null,
        measuredCalls ? "measured" : "not-instrumented",
        provenance.concurrentTasks,
      ),
      field(
        "externalCallsPerMinute",
        budget.externalCallsPerMinute,
        rateable ? perMinute(calls, windowMs) : null,
        budget.externalCallsPerMinute === null ? "undeclared" : rateEvidence,
        provenance.externalCallsPerMinute,
      ),
      field(
        "maySpawnWorker",
        budget.maySpawnWorker,
        null,
        "declared-only",
        provenance.maySpawnWorker,
      ),
    ],
  };
}

/** A slice present on disk but absent from the registry. Never assumed free. */
export function buildUnaccountedReport(slice: string): SliceResourceReport {
  return {
    slice,
    accounted: false,
    rationale: "No registry entry. Its cost is unknown, not zero.",
    windowMs: 0,
    calls: 0,
    fields: [],
  };
}

/**
 * Assemble the whole report.
 *
 * `knownSlices` is the authoritative on-disk list, so a slice can never be hidden by
 * forgetting to register it.
 */
export function buildResourceReport(input: {
  knownSlices: readonly string[];
  buckets: readonly SliceUsageAggregate[];
  droppedSamples: number;
  bufferCapacity: number;
  now?: number;
}): SliceResourceReportSet {
  const now = input.now ?? Date.now();
  const bySlice = new Map(input.buckets.map((bucket) => [bucket.slice, bucket]));
  const registered = new Map(REGISTRY.map((entry) => [entry.slice, entry]));

  const slices: SliceResourceReport[] = [];
  for (const entry of REGISTRY) {
    // A registry entry for a deleted slice is a stale claim, so it is only reported
    // when the directory still exists.
    if (!input.knownSlices.includes(entry.slice)) continue;
    slices.push(buildSliceReport(entry.slice, entry.budget, entry.provenance, entry.rationale, bySlice.get(entry.slice), now));
  }
  const unaccountedSlices = input.knownSlices.filter((slice) => !registered.has(slice)).sort();

  const unattributed = bySlice.get("");
  return {
    generatedAt: new Date(now).toISOString(),
    bufferCapacity: input.bufferCapacity,
    droppedSamples: input.droppedSamples,
    slices,
    unaccountedSlices,
    unaccounted: {
      calls: unattributed?.calls ?? 0,
      wallMs: unattributed?.wallMs ?? 0,
      cpuMs: unattributed?.cpuMs ?? 0,
    },
  };
}

/** Worst offenders: declared fields over budget first, then heaviest measured CPU. */
export function worstOffenders(report: SliceResourceReportSet, limit = 5): SliceResourceReport[] {
  const over = (row: SliceResourceReport) => row.fields.filter((f) => f.status === "over").length;
  const cpu = (row: SliceResourceReport) =>
    row.fields.find((f) => f.field === "cpuMsPerMinute")?.actual as number | null ?? 0;
  return [...report.slices]
    .filter((row) => over(row) > 0 || cpu(row) > 0)
    .sort((a, b) => over(b) - over(a) || cpu(b) - cpu(a) || a.slice.localeCompare(b.slice))
    .slice(0, limit);
}
