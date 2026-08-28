"use client";

// Host-I/O PORT — the generic seam apps read to reach a backend (fs/exec/sys/
// apps/auth). The interface + React context live here in the brand-free
// framework; each CONSUMER injects a concrete adapter (mso: HTTP→/api/v1 or
// in-browser mock; a Convex consumer: useQuery/useMutation) via
// <HostApiProvider api=…>. App slices import `useOsApi` + these types through
// the shell barrel (a legal alias) — never a project-specific @/lib path — so
// the same app runs against any backend that satisfies this contract.

import { createContext, useContext, type ReactNode } from "react";

export type Unsub = () => void;

export type HostAccessRole = "viewer" | "operator" | "owner" | "demo";
export type HostAccess = {
  role: HostAccessRole;
  canRead: boolean;
  canOperate: boolean;
  canOwn: boolean;
};

export type SysStats = {
  cpu: { pct: number; cores: number };
  mem: { used: number; total: number };
  disk: { used: number; total: number };
  net?: { rx: number; tx: number };
  /** Host uptime in MILLISECONDS. */
  uptime: number;
};

export type FsEntry = {
  name: string;
  kind: "dir" | "file";
  size: number;
  ext?: string;
  mime?: string;
};
export type FsRoot = { label: string; path: string };
export type FsList = {
  /** Canonical absolute path the host resolved (e.g. "/" → "/home/user"). */
  path: string;
  entries: FsEntry[];
  /** Jump-point roots (Home, Projects, Filesystem…) for the sidebar. */
  roots?: FsRoot[];
  /** Parent dir within bounds, or null at a root. */
  parent?: string | null;
};
export type FsUsage = { used: number; total: number };

/** A search hit — a folder (or file) matched by name under a search root. */
export type FsHit = { name: string; path: string; kind: "dir" | "file" };

/** One upload item. `relPath` keeps folder structure (e.g. "imgs/a.png"); for a
 * loose file it's just the name. `file` carries the raw bytes. */
export type UploadFile = { relPath: string; file: File };
/** Per-request upload outcome: how many landed, and which relPaths were skipped. */
export type UploadResult = { written: number; failed?: string[] };
/** Upload progress tick — bytes sent so far / total bytes across the whole batch. */
export type UploadProgress = { loaded: number; total: number };

/** One-shot command result: full stdout/stderr + exit code (no streaming/pty). */
export type ExecResult = { stdout: string; stderr: string; code: number };

export type Process = {
  pid: number;
  name: string;
  status: string;
  cpu: number;
  mem: number;
};

export type ServiceScope = "system" | "user";
export type ServiceAction = "start" | "stop" | "restart";
export type SystemService = {
  unit: string;
  scope: ServiceScope;
  load: string;
  active: string;
  sub: string;
  description: string;
  controllable: boolean;
};
export type ServiceInventory = {
  services: SystemService[];
  diagnostics: string[];
  truncated: boolean;
  controlAllowlistConfigured: boolean;
  generatedAt: string;
};
export type ServiceLogs = {
  unit: string;
  scope: ServiceScope;
  entries: string[];
  available: boolean;
  diagnostic?: string;
};
export type PackageUpdate = {
  name: string;
  current?: string;
  candidate: string;
  architecture?: string;
};
export type PackageUpdateSummary = {
  manager: "apt" | "dnf" | "yum" | "pacman" | "zypper" | null;
  available: boolean;
  updates: PackageUpdate[];
  truncated: boolean;
  checkedAt: string;
  source: "local-cache";
  diagnostic?: string;
};

export type AppManifest = { name: string; slug: string; runtime: string; entry: string };

/** A managed application on the host (hermes, openclaw) — the thing that actually
 *  has server state, unlike the UI app list, which lives in localStorage. */
export type ManagedAppSummary = { id: string; name: string; installed: boolean; running: boolean };
export type ManagedAppAction = "start" | "stop" | "restart" | "backup";
export type BrowserState = { installed: boolean; running: boolean; autostart: boolean };

export type OsApi = {
  mode: "mock" | "live";
  access: HostAccess;
  auth: {
    token: (u: string, p: string) => Promise<{ token: string; expires_at: number }>;
    me: () => Promise<{ user: { name: string; id: string } }>;
  };
  fs: {
    list: (path: string) => Promise<FsList>;
    read: (path: string) => Promise<string>;
    write: (path: string, content: string) => Promise<{ ok: boolean }>;
    mkdir: (path: string) => Promise<{ kind: "dir" }>;
    remove: (path: string) => Promise<{ ok: boolean }>;
    /** Move/rename: `to` is the full destination path (rename == move within dir). */
    move: (from: string, to: string) => Promise<{ ok: boolean }>;
    /** Recursive copy of a file or dir to a full destination path. */
    copy: (from: string, to: string) => Promise<{ ok: boolean }>;
    /** Binary-safe upload of files (and folders, via relPath) into `dest`.
     * `onProgress` fires as bytes go out (chunked under the hood for reliability). */
    upload: (
      dest: string,
      files: UploadFile[],
      onProgress?: (p: UploadProgress) => void,
    ) => Promise<UploadResult>;
    /** Find folders by name under a root (default ~/projects). Read-only. */
    search: (query: string) => Promise<FsHit[]>;
    usage: () => Promise<FsUsage>;
  };
  exec: {
    /** Run a shell command on the host (cwd defaults to home). One-shot, captured output. */
    run: (cmd: string, cwd?: string) => Promise<ExecResult>;
  };
  sys: {
    stats: () => Promise<SysStats>;
    statsStream: (onEvent: (s: Partial<SysStats>) => void) => Unsub;
    processes: () => Promise<Process[]>;
    services: () => Promise<ServiceInventory>;
    serviceLogs: (scope: ServiceScope, unit: string, limit?: number) => Promise<ServiceLogs>;
    servicePower: (scope: ServiceScope, unit: string, action: ServiceAction) => Promise<SystemService>;
    packageUpdates: () => Promise<PackageUpdateSummary>;
  };
  // Managed apps, not the UI app list. `start`/`stop` used to sit here pointed at
  // /apps/:slug/start and /apps/:slug/stop — neither of which is a route — while
  // `list` hit /apps, which returns [] by construction.
  apps: {
    list: () => Promise<ManagedAppSummary[]>;
    logs: (id: string) => Promise<{ available: boolean; entries: string[] }>;
    power: (id: string, action: ManagedAppAction) => Promise<ManagedAppSummary>;
  };
  browser: {
    status: () => Promise<BrowserState>;
    power: (on: boolean) => Promise<BrowserState>;
  };
};

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
