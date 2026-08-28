"use client";

// mso side of the slice's host seam: everything project-specific the
// slice touches re-exports from the shell + OsApi here. The rr catalog
// copy replaces this file with a self-contained version (injectable
// SysMonAdapter + no-op inspector) — every other file is line-identical.

export type { AppDescriptor } from "@/features/os-shell";
export { usePublishInspector } from "@/features/os-shell";
export {
  useOsApi,
  type SysStats,
  type Process,
  type HostAccess,
  type ServiceScope,
  type ServiceAction,
  type SystemService,
  type ServiceInventory,
  type ServiceLogs,
  type PackageUpdateSummary,
} from "@/features/os-shell";
export { useResponsive, ResponsiveToolbar } from "@/features/os-shell";
export type { ToolbarItem } from "@/features/os-shell";
export { useActiveShell } from "@/features/os-shell";
