"use client";

// Host-I/O PORT — the generic seam apps read to reach a backend (fs/exec/sys/
// apps/auth). The interface + React context live here in the brand-free
// framework; each CONSUMER injects a concrete adapter (mso: HTTP→/api/v1 or
// in-browser mock; a Convex consumer: useQuery/useMutation) via
// <HostApiProvider api=…>. App slices import `useOsApi` + these types through
// the shell barrel (a legal alias) — never a project-specific @/lib path — so
// the same app runs against any backend that satisfies this contract.

import { createContext, useContext, type ReactNode } from "react";

export type {
  Unsub, HostAccessRole, HostAccess, SysStats, FsEntry, FsRoot, FsList, FsUsage, FsHit,
  UploadFile, UploadResult, UploadProgress, ExecResult, Process, ServiceScope, ServiceAction,
  SystemService, ServiceInventory, ServiceLogs, PackageUpdate, PackageUpdateSummary, AppManifest,
  ManagedAppSummary, ManagedAppAction, BrowserState, OsApi,
} from "@/lib/contracts/os-api";
import type { OsApi } from "@/lib/contracts/os-api";

const HostApiContext = createContext<OsApi | null>(null);

// The consumer computes its adapter (mock|live HTTP, or Convex) and injects it
// here; every app reads it via useOsApi(). Mounting stays in the consumer
// (mso mounts it from app/os-root, wrapping this provider) so the brand-free
// framework carries no route/auth assumptions.
export function HostApiProvider({
  api,
  children,
}: {
  api: OsApi;
  children: ReactNode;
}) {
  return <HostApiContext.Provider value={api}>{children}</HostApiContext.Provider>;
}

export function useOsApi(): OsApi {
  const api = useContext(HostApiContext);
  if (!api) throw new Error("useOsApi must be used within a HostApiProvider");
  return api;
}
