/** Pure host I/O contract shared by server adapters and the brand-free AppShell. */
export type Unsub = () => void;
export type HostAccessRole = "viewer" | "operator" | "owner" | "demo";
export type HostAccess = { role: HostAccessRole; canRead: boolean; canOperate: boolean; canOwn: boolean };
export type SysStats = {
  cpu: { pct: number; cores: number };
  mem: { used: number; total: number };
  disk: { used: number; total: number };
  net?: { rx: number; tx: number };
  uptime: number;
};
export type FsEntry = { name: string; kind: "dir" | "file"; size: number; ext?: string; mime?: string };
export type FsRoot = { label: string; path: string };
export type FsList = { path: string; entries: FsEntry[]; roots?: FsRoot[]; parent?: string | null };
export type FsUsage = { used: number; total: number };
export type FsHit = { name: string; path: string; kind: "dir" | "file" };
export type UploadFile = { relPath: string; file: File };
export type UploadResult = { written: number; failed?: string[] };
export type UploadProgress = { loaded: number; total: number };
export type ExecResult = { stdout: string; stderr: string; code: number };
export type Process = { pid: number; name: string; status: string; cpu: number; mem: number };
export type ServiceScope = "system" | "user";
export type ServiceAction = "start" | "stop" | "restart";
export type SystemService = {
  unit: string; scope: ServiceScope; load: string; active: string; sub: string;
  description: string; controllable: boolean;
};
export type ServiceInventory = {
  services: SystemService[]; diagnostics: string[]; truncated: boolean;
  controlAllowlistConfigured: boolean; generatedAt: string;
};
export type ServiceLogs = {
  unit: string; scope: ServiceScope; entries: string[]; available: boolean; diagnostic?: string;
};
export type PackageUpdate = { name: string; current?: string; candidate: string; architecture?: string };
export type PackageUpdateSummary = {
  manager: "apt" | "dnf" | "yum" | "pacman" | "zypper" | null;
  available: boolean; updates: PackageUpdate[]; truncated: boolean; checkedAt: string;
  source: "local-cache"; diagnostic?: string;
};
export type AppManifest = { name: string; slug: string; runtime: string; entry: string };
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
    move: (from: string, to: string) => Promise<{ ok: boolean }>;
    copy: (from: string, to: string) => Promise<{ ok: boolean }>;
    upload: (dest: string, files: UploadFile[], onProgress?: (p: UploadProgress) => void) => Promise<UploadResult>;
    search: (query: string) => Promise<FsHit[]>;
    usage: () => Promise<FsUsage>;
  };
  exec: { run: (cmd: string, cwd?: string) => Promise<ExecResult> };
  sys: {
    stats: () => Promise<SysStats>;
    statsStream: (onEvent: (s: Partial<SysStats>) => void) => Unsub;
    processes: () => Promise<Process[]>;
    services: () => Promise<ServiceInventory>;
    serviceLogs: (scope: ServiceScope, unit: string, limit?: number) => Promise<ServiceLogs>;
    servicePower: (scope: ServiceScope, unit: string, action: ServiceAction) => Promise<SystemService>;
    packageUpdates: () => Promise<PackageUpdateSummary>;
  };
  apps: {
    list: () => Promise<ManagedAppSummary[]>;
    logs: (id: string) => Promise<{ available: boolean; entries: string[] }>;
    power: (id: string, action: ManagedAppAction) => Promise<ManagedAppSummary>;
  };
  browser: { status: () => Promise<BrowserState>; power: (on: boolean) => Promise<BrowserState> };
};
