import { describe, expect, it } from "vitest";
import { formatTable, perfViolations } from "./perf-report.mjs";
import { timingSkipReason } from "./perf-timing-load.mjs";
import { sampleBaseline, sampleBudget, validReport, validRunDesktop, validRunMobile } from "./perf-report.fixtures";

const run = (overrides: Record<string, unknown>) => ({ ...validRunDesktop, ...overrides });

describe("perfViolations", () => {
  it("passes a report that matches its baseline", () => {
    expect(perfViolations(validReport, sampleBudget, sampleBaseline)).toEqual([]);
  });

  it("fails on a tbt blowup past the factor, naming the run and both numbers", () => {
    const violations = perfViolations({ runs: [run({ tbtMs: 850 }), validRunMobile] }, sampleBudget, sampleBaseline);
    expect(violations).toContain("desktop: tbtMs 850ms > 2x baseline 146ms");
  });

  it("does not fail a run whose tbt is inside the factor", () => {
    const violations = perfViolations({ runs: [run({ tbtMs: 280 }), validRunMobile] }, sampleBudget, sampleBaseline);
    expect(violations).toEqual([]);
  });

  it("skips the tbt check entirely when no baseline exists", () => {
    // First run after a deliberate reset has nothing to compare against. Inventing a
    // zero baseline would fail every run, so absence means skip.
    const slow = { runs: [run({ tbtMs: 5000 }), validRunMobile] };
    expect(perfViolations(slow, sampleBudget, null)).toEqual([]);
    expect(perfViolations(slow, sampleBudget, undefined)).toEqual([]);
  });

  it("treats a null tbt as a violation when a baseline exists", () => {
    // A painted shell with no attributable long task means the probe broke, not that the
    // page got fast. Passing this is how a perf gate silently stops gating.
    const violations = perfViolations({ runs: [run({ tbtMs: null }), validRunMobile] }, sampleBudget, sampleBaseline);
    expect(violations).toContain("desktop: missing tbtMs measurement");
    expect(violations.some((v) => v.startsWith("mobile:"))).toBe(false);
  });

  it("fails a missing tbt for a label present in the baseline", () => {
    const { tbtMs: _drop, ...withoutTbt } = validRunDesktop;
    expect(() => perfViolations({ runs: [withoutTbt] }, sampleBudget, sampleBaseline)).not.toThrow();
  });

  it("never turns an advisory target miss into a violation", () => {
    // Both runs blow past the tbtMs 150 target and sit exactly on their baseline; the
    // target exists to describe the post-migration goal, not to fail today's build.
    const atBaseline = { runs: [run({ tbtMs: 146, lcpMs: 9000 }), validRunMobile] };
    expect(perfViolations(atBaseline, sampleBudget, sampleBaseline)).toEqual([]);
  });

  it("fails on a first-load byte cap even when timings are fine", () => {
    const budget = { ...sampleBudget, enforce: { ...sampleBudget.enforce, firstLoadJsBytes: { desktop: 900000 } } };
    expect(perfViolations({ runs: [run({}), validRunMobile] }, budget, sampleBaseline))
      .toContain(`desktop: firstLoadJsBytes 964362 > 900000`);
  });

  it("fails on a non-finite byte measurement rather than scoring it as zero", () => {
    const budget = { ...sampleBudget, enforce: { ...sampleBudget.enforce, firstLoadJsBytes: { desktop: 900000 } } };
    const violations = perfViolations({ runs: [run({ firstLoadJsBytes: Number.NaN })] }, budget, sampleBaseline);
    expect(violations).toContain("desktop: missing measurement");
  });
});

describe("timingSkipReason", () => {
  const idleReport = { host: { loadAvg1: 1.2 }, runs: [validRunDesktop, validRunMobile] };
  const busyReport = { host: { loadAvg1: 9.5 }, runs: [validRunDesktop, validRunMobile] };
  const budgetWithLoad = { ...sampleBudget, enforce: { ...sampleBudget.enforce, maxLoadAvg1ForTiming: 4 } };

  it("returns null when the host is idle enough to compare", () => {
    expect(timingSkipReason(idleReport, budgetWithLoad, null)).toBeNull();
  });

  it("explains the skip when load exceeds the budget ceiling", () => {
    const reason = timingSkipReason(busyReport, budgetWithLoad, null);
    expect(reason).toContain("9.5");
    expect(reason).toContain("idle host");
  });

  it("returns null when no ceiling or no measured load exists", () => {
    expect(timingSkipReason(busyReport, sampleBudget, null)).toBeNull();
    expect(timingSkipReason({ runs: [] }, budgetWithLoad, null)).toBeNull();
  });

  it("skips the comparison when the runner has a different core count", () => {
    // A 2-4 core GitHub runner and a 16-core workstation are different instruments for a
    // wall-clock metric. CI measured 271-321 ms against a 164/132 ms baseline and failed,
    // which said nothing about the commit.
    const ciRun = { runs: [run({ tbtMs: 321 })], host: { cpus: 4, loadAvg1: 1.2 } };
    const baseline16 = { host: { cpus: 16 }, runs: [{ label: "desktop", tbtMs: 146 }] };
    expect(timingSkipReason(ciRun, sampleBudget, baseline16)).toContain("4 cpus");
    expect(perfViolations(ciRun, sampleBudget, baseline16)).toEqual([]);
  });

  it("still compares when the core count matches", () => {
    const sameHost = { runs: [run({ tbtMs: 900 })], host: { cpus: 16, loadAvg1: 1.2 } };
    const baseline16 = { host: { cpus: 16 }, runs: [{ label: "desktop", tbtMs: 146 }] };
    expect(timingSkipReason(sameHost, sampleBudget, baseline16)).toBeNull();
    expect(perfViolations(sameHost, sampleBudget, baseline16)).toContain("desktop: tbtMs 900ms > 2x baseline 146ms");
  });

  it("still reports a real regression at idle, so the gate is not disarmed", () => {
    // At idle the comparison must run; skipping is only for an uncomparable host.
    const violations = perfViolations({ runs: [run({ tbtMs: 900 })], host: { loadAvg1: 1 } }, sampleBudget, sampleBaseline);
    expect(violations).toContain("desktop: tbtMs 900ms > 2x baseline 146ms");
  });
});

describe("formatTable", () => {
  it("aligns columns to the widest cell and keeps every run on its own line", () => {
    const text = formatTable(validReport);
    const lines = text.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^label\s+fcp\s+lcp\s+tbt\s+cls\s+maxTask\s+jsKB$/);
    expect(lines[1]).toContain("desktop");
    expect(lines[2]).toContain("mobile");
    // Every data line ends with the byte count converted to KB.
    expect(lines[1].trim().endsWith("941.8KB")).toBe(true);
    expect(lines[2].trim().endsWith("925.6KB")).toBe(true);
  });

  it("renders a null metric as n/a instead of 0", () => {
    const text = formatTable({ runs: [run({ lcpMs: null })] });
    expect(text).toContain("n/a");
    expect(text).not.toMatch(/\s0ms/);
  });

  it("returns an empty string for a report with no runs", () => {
    expect(formatTable({ runs: [] })).toBe("");
  });
});
