// Read-only package cache view logic. No apply, no upgrade, no install: the
// panel exists to show what the host already knows, per the repository rule that
// the Viewer/Operator surface must not offer package mutation.
import type { PackageUpdate, PackageUpdateSummary } from "./managed-apps-api.ts";

export type PackageStatusFilter = "all" | "upgradable" | "installed" | "unknown";
export type PackageSortKey = "name" | "current" | "candidate" | "architecture";
export type SortDirection = "asc" | "desc";

export const STATUS_FILTERS: readonly { id: PackageStatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "upgradable", label: "Upgradable" },
  { id: "installed", label: "Installed" },
  { id: "unknown", label: "Version unknown" },
];

export function packageStatus(pkg: Pick<PackageUpdate, "current" | "candidate">): "upgradable" | "installed" | "unknown" {
  if (pkg.current === undefined || !pkg.current.trim()) return "unknown";
  return pkg.current.trim() === pkg.candidate.trim() ? "installed" : "upgradable";
}

export function matchesStatus(pkg: PackageUpdate, filter: PackageStatusFilter): boolean {
  return filter === "all" || packageStatus(pkg) === filter;
}

export type PackageCounts = { total: number; upgradable: number; installed: number; unknown: number; truncated: boolean };

export function packageCounts(summary: Pick<PackageUpdateSummary, "updates" | "truncated">): PackageCounts {
  const counts: PackageCounts = { total: summary.updates.length, upgradable: 0, installed: 0, unknown: 0, truncated: summary.truncated };
  for (const pkg of summary.updates) counts[packageStatus(pkg)] += 1;
  return counts;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function sortPackages(
  packages: readonly PackageUpdate[], key: PackageSortKey, direction: SortDirection,
): PackageUpdate[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...packages].sort((a, b) => {
    if (key === "name") return sign * collator.compare(a.name, b.name);
    const left = key === "architecture" ? a.architecture ?? "" : key === "current" ? a.current ?? "" : a.candidate;
    const right = key === "architecture" ? b.architecture ?? "" : key === "current" ? b.current ?? "" : b.candidate;
    return sign * collator.compare(left, right) || collator.compare(a.name, b.name);
  });
}

export function filterPackages(
  packages: readonly PackageUpdate[], filter: PackageStatusFilter, query: string,
  key: PackageSortKey = "name", direction: SortDirection = "asc",
): PackageUpdate[] {
  const needle = query.trim().toLowerCase();
  const matched = packages.filter((pkg) => {
    if (!matchesStatus(pkg, filter)) return false;
    if (!needle) return true;
    return `${pkg.name} ${pkg.current ?? ""} ${pkg.candidate} ${pkg.architecture ?? ""}`.toLowerCase().includes(needle);
  });
  return sortPackages(matched, key, direction);
}

export function nextDirection(current: SortDirection): SortDirection {
  return current === "asc" ? "desc" : "asc";
}

export function ariaSort(active: boolean, direction: SortDirection): "ascending" | "descending" | "none" {
  if (!active) return "none";
  return direction === "asc" ? "ascending" : "descending";
}
