// Host-load awareness for the timing half of the perf gate.
//
// Split out of perf-report.mjs because that file sits against the repo's 220-line ratchet
// and this concern is separable: perf-report owns "is this number above a threshold", this
// owns "is this number even comparable to the baseline".
//
// Why it exists: TBT is wall-clock inside a browser, so it tracks host load. The committed
// baseline was taken on an idle box; the same commit has since measured 138 ms at load ~1
// and 794 ms at load ~13. A blowup factor cannot tell that apart from a real regression, so
// the comparison is skipped with a printed reason instead of failing or passing silently.
// The deterministic byte checks are unaffected by load and always run.

/**
 * Explains why a timing check was skipped, or null when it ran.
 * Kept separate from perfViolations so that function stays a pure string[] and callers
 * cannot accidentally treat a note as a failure.
 *
 * @param {any} report
 * @param {any} budget
 * @returns {string|null}
 */
export function timingSkipReason(report, budget, baseline) {
  const r = typeof report === "string" ? JSON.parse(report) : report;
  const load = r?.host?.loadAvg1;
  const maxLoad = Number(budget?.enforce?.maxLoadAvg1ForTiming);
  if (Number.isFinite(maxLoad) && Number.isFinite(load) && load > maxLoad) {
    return `tbt not compared: host load1=${load} exceeds ${maxLoad}, and the committed baseline was measured on an idle host`;
  }
  // Core count matters as much as load: TBT is wall-clock, so a 2-core CI runner and a
  // 16-core workstation are different instruments. The baseline records the machine it
  // was taken on; a run elsewhere is skipped rather than allowed to fail or pass.
  const baseCpus = Number(baseline?.host?.cpus);
  const runCpus = Number(r?.host?.cpus);
  if (Number.isFinite(baseCpus) && Number.isFinite(runCpus) && baseCpus !== runCpus) {
    return `tbt not compared: this host has ${runCpus} cpus, the committed baseline was taken on ${baseCpus}`;
  }
  return null;
}
