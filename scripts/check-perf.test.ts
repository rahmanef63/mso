import { describe, expect, it } from "vitest";
import { parsePerfReport, perfViolations } from "./lib/perf-report.mjs";
import { timingSkipReason } from "./lib/perf-timing-load.mjs";

const baseline = {
  schemaVersion: 1,
  host: { cpus: 16, loadAvg1AtMeasure: 0.32 },
  runs: [
    { label: "desktop", tbtMs: 164 },
    { label: "mobile", tbtMs: 132 },
  ],
};

const budget = {
  schemaVersion: 1,
  enforce: {
    tbtMsBlowupFactor: 2.0,
    maxLoadAvg1ForTiming: 4.0,
  },
};

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    label: "desktop",
    viewport: { width: 1440, height: 900 },
    fcpMs: 1180,
    lcpMs: 3222,
    tbtMs: 164,
    cls: 0.001,
    longTasks: 4,
    maxLongTaskMs: 128,
    firstLoadJsBytes: 900_000,
    ...overrides,
  };
}

function makeReport(
  runOverrides: Record<string, unknown> = {},
  hostOverrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 1,
    host: {
      cpus: 16,
      loadAvg1: 0.5,
      ...hostOverrides,
    },
    runs: [
      makeRun(runOverrides),
      {
        label: "mobile",
        viewport: { width: 390, height: 844 },
        fcpMs: 1166,
        lcpMs: 3054,
        tbtMs: 132,
        cls: 0,
        longTasks: 4,
        maxLongTaskMs: 126,
        firstLoadJsBytes: 850_000,
      },
    ],
  };
}

describe("check-perf gate verification", () => {
  it("1. synthetic report over the byte cap -> violation", () => {
    const budgetWithCap = {
      ...budget,
      enforce: { ...budget.enforce, firstLoadJsBytes: { desktop: 800_000 } },
    };
    const report = parsePerfReport(makeReport({ firstLoadJsBytes: 950_000 }));
    const violations = perfViolations(report, budgetWithCap, baseline);
    expect(violations).toContain("desktop: firstLoadJsBytes 950000 > 800000");
  });

  it("2. report with missing tbtMs -> violation (a null measurement must fail, not pass)", () => {
    const report = parsePerfReport(makeReport({ tbtMs: null }));
    const violations = perfViolations(report, budget, baseline);
    expect(violations).toContain("desktop: missing tbtMs measurement");
  });

  it("3. TBT above 2x baseline, same core count, idle load -> violation", () => {
    // Baseline is 164ms, blowup limit is 328ms. 350ms > 328ms.
    const report = parsePerfReport(makeReport({ tbtMs: 350 }, { cpus: 16, loadAvg1: 0.5 }));
    const violations = perfViolations(report, budget, baseline);
    expect(violations).toContain("desktop: tbtMs 350ms > 2x baseline 164ms");
    expect(timingSkipReason(report, budget, baseline)).toBeNull();
  });

  it("4. same report, different core count -> no violation AND timingSkipReason explains it", () => {
    // Same inflated TBT (350ms) and idle load (0.5), but running on 4 cpus instead of baseline 16.
    const report = parsePerfReport(makeReport({ tbtMs: 350 }, { cpus: 4, loadAvg1: 0.5 }));
    const violations = perfViolations(report, budget, baseline);
    expect(violations).toEqual([]);
    const reason = timingSkipReason(report, budget, baseline);
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/this host has 4 cpus, the committed baseline was taken on 16/);
  });

  it("5. same report, load above maxLoadAvg1ForTiming -> no violation AND the reason explains the load", () => {
    // Same inflated TBT (350ms) and matching cpus (16), but loadAvg1 is 7.5 > maxLoadAvg1ForTiming (4.0).
    const report = parsePerfReport(makeReport({ tbtMs: 350 }, { cpus: 16, loadAvg1: 7.5 }));
    const violations = perfViolations(report, budget, baseline);
    expect(violations).toEqual([]);
    const reason = timingSkipReason(report, budget, baseline);
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/host load1=7.5 exceeds 4/);
  });

  it("6. clean report -> no violations, no skip reason", () => {
    const report = parsePerfReport(makeReport({ tbtMs: 160 }, { cpus: 16, loadAvg1: 0.5 }));
    const violations = perfViolations(report, budget, baseline);
    expect(violations).toEqual([]);
    expect(timingSkipReason(report, budget, baseline)).toBeNull();
  });
});
