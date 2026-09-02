"use client";

// mso side of the slice's host seam: everything project-specific the
// slice touches re-exports from the shell + OsApi here. The rr catalog
// copy replaces this file with a self-contained version (injectable
// CodeFsAdapter + no-op inspector) — every other file is line-identical.

export type { AppProps, AppDescriptor } from "@/features/appshell";
export { usePublishInspector, setCloseGuard, closeWindow } from "@/features/appshell";
export { useOsApi, type FsEntry } from "@/features/appshell";
