import { describe, expect, it } from "vitest";
import { MIN_PROJECTION_MS, buildResourceReport, buildSliceReport, buildUnaccountedReport, perMinute, worstOffenders } from "./report";
import type { SliceUsageAggregate } from "./ledger";
import type { SliceBudget, SliceBudgetProvenance } from "./types";

const prov = (note: string, kind: SliceBudgetProvenance[keyof SliceBudgetProvenance]["kind"] = "cited"): SliceBudgetProvenance[keyof SliceBudgetProvenance] => ({
  kind,
  file: "lib/host/exec.ts",
  line: 16,
  note,
});

const budget: SliceBudget = {
  cpuMsPerMinute: 60_000,
  memoryMiB: 64,
  concurrentTasks: 4,
  externalCallsPerMinute: 30,
  maySpawnWorker: false,
};
const provenance: SliceBudgetProvenance = {
  cpuMsPerMinute: prov("cpu policy"),
  memoryMiB: prov("memory policy", "policy"),
  concurrentTasks: prov("slot policy", "policy"),
  externalCallsPerMinute: prov("calls"),
  maySpawnWorker: prov("worker"),
};

const usage = (over: Partial<SliceUsageAggregate> = {}): SliceUsageAggregate => ({
  slice: "system-monitor",
  calls: 10,
  wallMs: 500,
  cpuMs: 4_000,
  peakConcurrency: 2,
  resultBytes: 1_000,
  unmeasuredResults: 0,
  firstAt: 1_000,
  lastAt: 30_000,
  ...over,
});

describe("per-minute projection", () => {
  it("scales a measured total to a minute", () => {
    expect(perMinute(30, 60_000)).toBe(30);
    expect(perMinute(15, 30_000)).toBe(30);
  });

  it("refuses to project from a zero or unusable window", () => {
    expect(perMinute(10, 0)).toBeNull();
    expect(perMinute(Number.NaN, 1_000)).toBeNull();
  });

  it("refuses a rate from too little elapsed time instead of reporting a spike", () => {
    // One fresh call in a 1 ms window would project to hundreds of thousands per
    // minute, which would render as "over budget" for an idle slice.
    expect(perMinute(4_000, 1)).toBeNull();
    expect(perMinute(4_000, MIN_PROJECTION_MS - 1)).toBeNull();
    expect(perMinute(4_000, MIN_PROJECTION_MS)).not.toBeNull();
  });
});

describe("budget vs actual", () => {
  it("reports within budget when the projection is under the declared ceiling", () => {
    // 10 calls over 30 s projects to 20/min against a 30/min ceiling.
    const row = buildSliceReport("system-monitor", budget, provenance, "rationale text here", usage(), 31_000);
    const calls = row.fields.find((field) => field.field === "externalCallsPerMinute");
    expect(calls?.actual).toBe(20);
    expect(calls?.status).toBe("within");
    expect(calls?.evidence).toBe("estimated");
  });

  it("reports over budget when the projection exceeds the ceiling", () => {
    const row = buildSliceReport("system-monitor", budget, provenance, "rationale text here", usage({ calls: 40 }), 31_000);
    const calls = row.fields.find((field) => field.field === "externalCallsPerMinute");
    expect(calls?.actual).toBe(80);
    expect(calls?.status).toBe("over");
  });

  it("reports a slice measured for too short a window as under-sampled, not over", () => {
    // A single call 50 ms ago: no honest per-minute rate exists yet.
    const fresh = usage({ firstAt: 10_000, lastAt: 10_050, calls: 1, cpuMs: 4_000 });
    const row = buildSliceReport("system-monitor", budget, provenance, "rationale text here", fresh, 10_100);
    const cpu = row.fields.find((field) => field.field === "cpuMsPerMinute");
    expect(cpu?.actual).toBeNull();
    expect(cpu?.evidence).toBe("under-sampled");
    expect(cpu?.status).toBe("unknown");
    // Concurrency is still a direct measurement, so it survives.
    expect(row.fields.find((field) => field.field === "concurrentTasks")?.evidence).toBe("measured");
  });

  it("marks CPU as an estimate, never as a measurement", () => {
    const row = buildSliceReport("system-monitor", budget, provenance, "rationale text here", usage(), 31_000);
    const cpu = row.fields.find((field) => field.field === "cpuMsPerMinute");
    expect(cpu?.evidence).toBe("estimated");
    expect(cpu?.actual).toBe(8_000);
  });

  it("marks concurrency as measured because the ledger counts it directly", () => {
    const row = buildSliceReport("system-monitor", budget, provenance, "rationale text here", usage(), 31_000);
    const slots = row.fields.find((field) => field.field === "concurrentTasks");
    expect(slots?.evidence).toBe("measured");
    expect(slots?.actual).toBe(2);
    expect(slots?.status).toBe("within");
  });

  it("reports memory as not-instrumented rather than borrowing another number", () => {
    const row = buildSliceReport("system-monitor", budget, provenance, "rationale text here", usage(), 31_000);
    const memory = row.fields.find((field) => field.field === "memoryMiB");
    expect(memory?.evidence).toBe("not-instrumented");
    expect(memory?.actual).toBeNull();
    expect(memory?.status).toBe("unknown");
  });

  it("reports a slice with no ledger traffic as not-instrumented, not as zero cost", () => {
    const row = buildSliceReport("docs", budget, provenance, "rationale text here", undefined, 31_000);
    expect(row.calls).toBe(0);
    for (const field of row.fields) {
      if (field.field === "maySpawnWorker") continue;
      expect(field.actual, field.field).toBeNull();
      expect(field.evidence, field.field).toBe("not-instrumented");
      expect(field.status, field.field).toBe("unknown");
    }
  });

  it("calls an undeclared call ceiling undeclared instead of free", () => {
    const row = buildSliceReport(
      "docs",
      { ...budget, externalCallsPerMinute: null },
      { ...provenance, externalCallsPerMinute: prov("no ceiling", "unmeasured") },
      "rationale text here",
      usage(),
      31_000,
    );
    const calls = row.fields.find((field) => field.field === "externalCallsPerMinute");
    expect(calls?.evidence).toBe("undeclared");
    expect(calls?.budget).toBeNull();
    expect(calls?.status).toBe("unknown");
  });

  it("keeps the worker flag declared-only because nothing measures a spawn", () => {
    const row = buildSliceReport("os-terminal", budget, provenance, "rationale text here", usage(), 31_000);
    const worker = row.fields.find((field) => field.field === "maySpawnWorker");
    expect(worker?.evidence).toBe("declared-only");
    expect(worker?.actual).toBeNull();
  });
});

describe("unaccounted slices", () => {
  it("reports a slice with no registry entry as unknown, not free", () => {
    const row = buildUnaccountedReport("brand-new-slice");
    expect(row.accounted).toBe(false);
    expect(row.fields).toEqual([]);
    expect(row.rationale).toMatch(/unknown, not zero/i);
  });

  it("lists every on-disk slice that has no registry entry", () => {
    const report = buildResourceReport({
      knownSlices: ["system-monitor", "docs", "brand-new-slice"],
      buckets: [usage()],
      droppedSamples: 0,
      bufferCapacity: 2_048,
      now: 31_000,
    });
    expect(report.unaccountedSlices).toEqual(["brand-new-slice"]);
    expect(report.slices.map((row) => row.slice)).toEqual(["docs", "system-monitor"]);
    // The registered slices still report; the unregistered one is never silently dropped.
    expect(report.slices.every((row) => row.accounted)).toBe(true);
  });

  it("ignores a registry entry whose slice directory no longer exists", () => {
    const report = buildResourceReport({ knownSlices: [], buckets: [], droppedSamples: 0, bufferCapacity: 2_048, now: 1 });
    expect(report.slices).toEqual([]);
  });

  it("reports unattributed capability cost separately from every slice total", () => {
    const report = buildResourceReport({
      knownSlices: ["system-monitor"],
      buckets: [usage(), usage({ slice: "", calls: 3, cpuMs: 900 })],
      droppedSamples: 2,
      bufferCapacity: 2_048,
      now: 31_000,
    });
    expect(report.unaccounted).toEqual({ calls: 3, wallMs: 500, cpuMs: 900 });
    expect(report.droppedSamples).toBe(2);
    expect(report.slices[0].calls).toBe(10);
  });
});

describe("worst offenders", () => {
  it("ranks an over-budget slice above a heavier one that is within budget", () => {
    const over = buildSliceReport("system-monitor", { ...budget, externalCallsPerMinute: 5 }, provenance, "r", usage(), 31_000);
    const heavy = buildSliceReport("assistant", budget, provenance, "r", usage({ calls: 10, cpuMs: 20_000 }), 31_000);
    const report = buildResourceReport({ knownSlices: ["system-monitor", "assistant"], buckets: [], droppedSamples: 0, bufferCapacity: 10, now: 1 });
    report.slices = [heavy, over];
    expect(worstOffenders(report, 2).map((row) => row.slice)).toEqual(["system-monitor", "assistant"]);
  });

  it("returns nothing when no slice has activity or a violation", () => {
    const report = buildResourceReport({ knownSlices: ["docs"], buckets: [], droppedSamples: 0, bufferCapacity: 10, now: 1 });
    expect(worstOffenders(report)).toEqual([]);
  });
});
