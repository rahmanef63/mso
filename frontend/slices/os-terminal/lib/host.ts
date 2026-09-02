"use client";

// mso side of the slice's host seam: everything project-specific the
// slice touches re-exports from the shell + OsApi here. The rr catalog
// copy replaces this file with a self-contained version (injectable
// TerminalOsApi + no-op inspector) — every other file is line-identical.

export type { AppDescriptor } from "@/features/appshell";
export { usePublishInspector } from "@/features/appshell";
export { useOsApi, type FsEntry } from "@/features/appshell";
export type { OsApi as TerminalOsApi } from "@/features/appshell";
export { fmtGiBPair, fmtUptime } from "@/lib/os-api/format";
