import { beforeEach, describe, expect, it } from "vitest";
import {
  beginSliceCall,
  aggregateSliceUsage,
  recordSliceUsage,
  resetSliceLedger,
  serializedBytes,
  sliceConcurrency,
  sliceUsageSamples,
  LEDGER_CAPACITY,
} from "./ledger";

const sample = (over: Partial<Parameters<typeof recordSliceUsage>[0]> = {}) => ({
  slice: "system-monitor",
  tool: "route:/api/v1/sys/stats",
  wallMs: 10,
  cpuMs: 4,
  resultBytes: 100,
  concurrent: 1,
  at: 1_000,
  ...over,
});

beforeEach(() => resetSliceLedger());

describe("slice ledger", () => {
  it("records and aggregates a slice's measured usage", () => {
    recordSliceUsage(sample());
    recordSliceUsage(sample({ wallMs: 30, cpuMs: 6, at: 1_500 }));
    const { buckets } = aggregateSliceUsage();
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ slice: "system-monitor", calls: 2, wallMs: 40, cpuMs: 10, resultBytes: 200, firstAt: 1_000, lastAt: 1_500 });
  });

  it("keeps unattributed calls in their own bucket so no slice total is inflated", () => {
    recordSliceUsage(sample());
    recordSliceUsage(sample({ slice: null, tool: "fs_read", cpuMs: 7 }));
    const { buckets } = aggregateSliceUsage();
    const unaccounted = buckets.find((bucket) => bucket.slice === "");
    expect(unaccounted?.calls).toBe(1);
    expect(buckets.find((bucket) => bucket.slice === "system-monitor")?.calls).toBe(1);
  });

  it("tracks peak concurrency per slice, not a running average", () => {
    recordSliceUsage(sample({ concurrent: 1 }));
    recordSliceUsage(sample({ concurrent: 3 }));
    recordSliceUsage(sample({ concurrent: 2 }));
    expect(aggregateSliceUsage().buckets[0].peakConcurrency).toBe(3);
  });

  it("counts an unmeasurable payload instead of pretending it was zero bytes", () => {
    // A payload that cannot be serialized is recorded as null, not as 0 bytes.
    recordSliceUsage({ ...sample(), resultBytes: null });
    const bucket = aggregateSliceUsage().buckets[0];
    expect(bucket.unmeasuredResults).toBe(1);
    expect(bucket.resultBytes).toBeNull();
  });

  it("evicts the oldest sample and reports the drop once capacity is reached", () => {
    for (let index = 0; index < LEDGER_CAPACITY + 5; index += 1) recordSliceUsage(sample({ at: index }));
    const { buckets, dropped } = aggregateSliceUsage();
    expect(dropped).toBe(5);
    expect(buckets[0].calls).toBe(LEDGER_CAPACITY);
    expect(sliceUsageSamples()).toHaveLength(LEDGER_CAPACITY);
  });

  it("ignores an invalid duration rather than poisoning the aggregate", () => {
    recordSliceUsage(sample({ wallMs: Number.NaN }));
    recordSliceUsage(sample({ wallMs: -1 }));
    expect(aggregateSliceUsage().buckets).toHaveLength(0);
  });

  it("counts this call in its own in-flight slot", () => {
    const release = beginSliceCall("workflows");
    expect(sliceConcurrency("workflows")).toBe(1);
    release();
    release();
    expect(sliceConcurrency("workflows")).toBe(1); // falls back to 1, never 0 or negative
    expect(sliceConcurrency(null)).toBe(1);
  });

  it("measures serialized bytes and reports null when serialization throws", () => {
    expect(serializedBytes("abc")).toBe(3);
    expect(serializedBytes({ a: 1 })).toBe(7);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(serializedBytes(cyclic)).toBeNull();
  });
});
