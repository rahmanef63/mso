import type { SliceUsageSample } from "./types";

/**
 * The resource ledger: what slices actually consumed, measured where work really
 * happens.
 *
 * Measurement point: `lib/capabilities/execute.ts` wraps every capability call, so
 * CPU, wall time, in-flight concurrency and result size are recorded per call rather
 * than sampled from a bundle or estimated from source size.
 *
 * Honesty limits, stated here because they are properties of the instrument:
 *   - `cpuMs` is `process.cpuUsage()` delta, so it is PROCESS-scoped. Under
 *     concurrency it includes work from other slices sharing the event loop, which
 *     makes it an upper bound, not an exclusive attribution.
 *   - the buffer is in-memory and process-local. It resets on restart and does not
 *     aggregate across instances.
 *   - a call with no owning slice is recorded with `slice: null` and reports as
 *     unaccounted. It is never dropped into a slice to make a total look complete.
 *
 * Cost note: one JSON serialization per capability call to measure result bytes.
 * The capability kernel is agent-paced (not a hot HTTP path), so that is cheaper
 * than threading the transport's already-serialized text back into the kernel.
 */
export const LEDGER_CAPACITY = 2_048;

const samples: SliceUsageSample[] = [];
const inFlight = new Map<string, number>();
let dropped = 0;

/** Current in-flight count for a slice key. Used to record concurrency honestly. */
export function sliceConcurrency(slice: string | null): number {
  return inFlight.get(slice ?? "") ?? 1;
}

/**
 * Mark a slice call as started. Returns the release function; calling it twice is a
 * no-op so a competing cleanup path cannot double-decrement.
 */
export function beginSliceCall(slice: string | null): () => void {
  const key = slice ?? "";
  inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (inFlight.get(key) ?? 1) - 1;
    if (next > 0) inFlight.set(key, next);
    else inFlight.delete(key);
  };
}

/** Append one measured sample, evicting the oldest when the buffer is full. */
export function recordSliceUsage(sample: SliceUsageSample): void {
  if (!Number.isFinite(sample.wallMs) || sample.wallMs < 0) return;
  if (samples.length >= LEDGER_CAPACITY) {
    samples.shift();
    dropped += 1;
  }
  samples.push(sample);
}

/** Bytes of a result payload. Measured by serialization, null when unserializable. */
export function serializedBytes(result: unknown): number | null {
  try {
    const text = typeof result === "string" ? result : JSON.stringify(result);
    return text === undefined ? 0 : Buffer.byteLength(text, "utf8");
  } catch {
    return null;
  }
}

export type SliceUsageAggregate = {
  slice: string;
  calls: number;
  /** Sum of measured wall time over the buffer window, milliseconds. */
  wallMs: number;
  /** Sum of measured process CPU time over the window, milliseconds. */
  cpuMs: number;
  /** Largest number of concurrent calls observed for this slice. */
  peakConcurrency: number;
  /** Sum of measured result bytes; null when no call had a measurable payload. */
  resultBytes: number | null;
  /** Calls whose result could not be serialized for measurement. */
  unmeasuredResults: number;
  firstAt: number;
  lastAt: number;
};

/** A single measurement bucket, either a real slice or the unaccounted bucket. */
const emptyAggregate = (slice: string): SliceUsageAggregate => ({
  slice,
  calls: 0,
  wallMs: 0,
  cpuMs: 0,
  peakConcurrency: 0,
  resultBytes: null,
  unmeasuredResults: 0,
  firstAt: 0,
  lastAt: 0,
});

/** Aggregate the whole buffer by slice. Unattributed calls land in `""`. */
export function aggregateSliceUsage(): { buckets: SliceUsageAggregate[]; dropped: number } {
  const bySlice = new Map<string, SliceUsageAggregate>();
  for (const sample of samples) {
    const key = sample.slice ?? "";
    const bucket = bySlice.get(key) ?? emptyAggregate(key);
    bucket.calls += 1;
    bucket.wallMs += sample.wallMs;
    bucket.cpuMs += sample.cpuMs;
    bucket.peakConcurrency = Math.max(bucket.peakConcurrency, sample.concurrent);
    if (sample.resultBytes == null) bucket.unmeasuredResults += 1;
    else bucket.resultBytes = (bucket.resultBytes ?? 0) + sample.resultBytes;
    bucket.firstAt = bucket.firstAt === 0 ? sample.at : Math.min(bucket.firstAt, sample.at);
    bucket.lastAt = Math.max(bucket.lastAt, sample.at);
    bySlice.set(key, bucket);
  }
  return { buckets: [...bySlice.values()], dropped };
}

/** Test seam only: clears the buffer and in-flight counters. */
export function resetSliceLedger(): void {
  samples.length = 0;
  inFlight.clear();
  dropped = 0;
}

/** Read-only view of raw samples, for tests and diagnostics. */
export function sliceUsageSamples(): readonly SliceUsageSample[] {
  return samples;
}
