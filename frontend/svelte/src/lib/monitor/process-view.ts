/** Pure process list shaping: filtering, sorting, and the summary KPI row. */
import type { Process } from "../../../../../lib/contracts/os-api";

export type ProcessSortKey = "cpu" | "mem" | "pid" | "name";
export type SortDirection = "asc" | "desc";
export type ProcessSummary = { total: number; topCpu: Process | null; totalRssMiB: number };

const NUMERIC: ReadonlySet<ProcessSortKey> = new Set(["cpu", "mem", "pid"]);

export function defaultDirection(key: ProcessSortKey): SortDirection {
  return key === "name" || key === "pid" ? "asc" : "desc";
}

export function matchesProcess(proc: Process, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return proc.name.toLowerCase().includes(needle)
    || proc.status.toLowerCase().includes(needle)
    || String(proc.pid).includes(needle);
}

export function sortProcesses(
  rows: readonly Process[],
  key: ProcessSortKey,
  direction: SortDirection,
): Process[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = NUMERIC.has(key)
      ? (a[key] as number) - (b[key] as number)
      : a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    if (primary !== 0) return primary * sign;
    if (a.pid !== b.pid) return a.pid - b.pid;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

export function summarize(rows: readonly Process[]): ProcessSummary {
  let topCpu: Process | null = null;
  let totalRssMiB = 0;
  for (const proc of rows) {
    totalRssMiB += Number.isFinite(proc.mem) && proc.mem > 0 ? proc.mem : 0;
    if (!topCpu || proc.cpu > topCpu.cpu) topCpu = proc;
  }
  return { total: rows.length, topCpu, totalRssMiB };
}
