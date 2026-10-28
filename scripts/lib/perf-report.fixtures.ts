// Shared fixtures for the perf-report tests. Kept out of the test files so each test file
// stays under the repo's 220-physical-line ratchet, and so the sample numbers exist once.
//
// The numbers mirror scripts/perf-baseline.json (Slow 4G, 4x CPU, median of 3 runs at
// commit 1c74603). They are deliberately realistic: a fixture with a 0 tbt would let a
// broken TBT formula pass.

export const validRunDesktop = {
  label: "desktop",
  viewport: { width: 1440, height: 900 },
  fcpMs: 1168,
  lcpMs: 3168,
  tbtMs: 146,
  cls: 0.001,
  longTasks: 4,
  maxLongTaskMs: 126,
  firstLoadJsBytes: 964362,
  firstLoadJsFiles: 20,
  transferBytes: 393216,
  domNodes: 870,
};

export const validRunMobile = {
  label: "mobile",
  viewport: { width: 390, height: 844 },
  fcpMs: 1156,
  lcpMs: 3096,
  tbtMs: 142,
  cls: 0,
  longTasks: 4,
  maxLongTaskMs: 126,
  firstLoadJsBytes: 947790,
  firstLoadJsFiles: 20,
  transferBytes: 350000,
  domNodes: 1165,
};

export const validReport = {
  schemaVersion: 1,
  createdAt: "2026-10-28T15:04:05.000Z",
  commit: "1c74603",
  runs: [validRunDesktop, validRunMobile],
};

export const sampleBudget = {
  schemaVersion: 1,
  enforce: { tbtMsBlowupFactor: 2.0 },
  targets: { initialGzipBytes: 256000, tbtMs: 150, lcpMs: 2500 },
  targetsEnforced: false,
};

export const sampleBaseline = {
  runs: [
    { label: "desktop", tbtMs: 146 },
    { label: "mobile", tbtMs: 142 },
  ],
};
