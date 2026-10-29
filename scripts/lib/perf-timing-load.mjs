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
export function timingSkipReason(report, budget) {
  const maxLoad = Number(budget?.enforce?.maxLoadAvg1ForTiming);
  const load = (typeof report === "string" ? JSON.parse(report) : report)?.host?.loadAvg1;
  if (!Number.isFinite(maxLoad) || !Number.isFinite(load) || load <= maxLoad) return null;
  return `tbt not compared: host load1=${load} exceeds ${maxLoad}, and the committed baseline was measured on an idle host`;
}
