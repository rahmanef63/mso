// Types for perf-report.mjs. Kept in a .d.ts so the implementation stays under the
// repo's 220-line ratchet and the shapes are visible to the TypeScript side (allowJs).
//
// `tbtMs` is nullable on purpose: null means "the probe did not observe one", which the
// gate treats as a violation when a baseline exists. It must never be coerced to 0.

export type PerfRun = {
  label: string;
  viewport?: { width: number; height: number };
  fcpMs: number | null;
  lcpMs: number | null;
  tbtMs: number | null;
  cls: number | null;
  longTasks?: number;
  maxLongTaskMs: number | null;
  firstLoadJsBytes: number | null;
  firstLoadJsFiles?: number;
  transferBytes?: number;
  domNodes?: number;
};

export type PerfReport = {
  schemaVersion: number;
  createdAt?: string;
  commit?: string | null;
  host?: { platform: string; cpus: number; node: string; totalMemMb: number };
  profile?: { name: string; latencyMs: number; downlinkKbps: number; uplinkKbps: number; cpuRate: number };
  runs: PerfRun[];
};

export type PerfSummary = {
  label: string;
  fcpMs: number | null;
  lcpMs: number | null;
  tbtMs: number | null;
  cls: number | null;
  firstLoadJsBytes: number | null;
  maxLongTaskMs: number | null;
};

export type PerfBudget = {
  schemaVersion?: number;
  note?: string;
  enforce: { firstLoadJsBytes?: Record<string, number>; tbtMsBlowupFactor?: number };
  targets?: { initialGzipBytes?: number; tbtMs?: number; lcpMs?: number };
  targetsEnforced?: boolean;
};

export function parsePerfReport(json: unknown): PerfReport;
export function summarize(report: PerfReport | { runs?: Array<Record<string, unknown>> } | string): PerfSummary[];
export function perfViolations(
  report: PerfReport | { runs?: Array<Record<string, unknown>>; host?: { loadAvg1?: number } } | string,
  budget: PerfBudget | null | undefined,
  baseline?: PerfReport | { runs?: Array<Record<string, unknown>> } | Record<string, unknown> | null,
): string[];
export function formatTable(report: PerfReport | { runs?: Array<Record<string, unknown>> } | string): string;

export function timingSkipReason(
  report: PerfReport | { runs?: Array<Record<string, unknown>>; host?: { loadAvg1?: number } } | string,
  budget: PerfBudget | null | undefined,
): string | null;
