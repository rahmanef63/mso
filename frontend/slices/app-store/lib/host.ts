"use client";

// mso side of the slice's host seam: everything project-specific the
// slice touches re-exports from the shell + OsApi here. The rr catalog
// copy replaces this file with a self-contained version (demo exec +
// no-op inspector) and bundles the Create-App flow in-slice.

export type { AppProps, AppDescriptor } from "@/features/appshell";
export { usePublishInspector } from "@/features/appshell";
export { useOsApi } from "@/features/appshell";
