/** Pure service list shaping: status buckets, status counts, and filter matching. */
import type { SystemService } from "../../../../../lib/contracts/os-api";

export type ServiceStatusFilter = "all" | "active" | "inactive" | "failed";
export type ServiceStatusCounts = Record<ServiceStatusFilter, number>;

export const SERVICE_FILTERS: { id: ServiceStatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "inactive", label: "Inactive" },
  { id: "failed", label: "Failed" },
];

export function serviceStatus(svc: SystemService): Exclude<ServiceStatusFilter, "all"> {
  if (svc.active === "failed" || svc.sub === "failed") return "failed";
  return svc.active === "active" ? "active" : "inactive";
}

export function countByStatus(rows: readonly SystemService[]): ServiceStatusCounts {
  const counts: ServiceStatusCounts = { all: rows.length, active: 0, inactive: 0, failed: 0 };
  for (const svc of rows) counts[serviceStatus(svc)] += 1;
  return counts;
}

export function matchesService(
  svc: SystemService,
  query: string,
  status: ServiceStatusFilter,
): boolean {
  if (status !== "all" && serviceStatus(svc) !== status) return false;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${svc.unit} ${svc.scope} ${svc.active} ${svc.sub} ${svc.description}`.toLowerCase().includes(needle);
}
