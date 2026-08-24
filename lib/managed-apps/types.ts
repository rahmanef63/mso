export const MANAGED_APP_IDS = ["hermes", "openclaw", "9router"] as const;
export type ManagedAppId = (typeof MANAGED_APP_IDS)[number];

export const MANAGED_APP_ACTIONS = ["start", "stop", "restart", "backup"] as const;
export type ManagedAppAction = (typeof MANAGED_APP_ACTIONS)[number];

export type ManagedAppState =
  | "not-installed"
  | "stopped"
  | "starting"
  | "running"
  | "unhealthy"
  | "error";

export interface ManagedAppDefinition {
  id: ManagedAppId;
  name: string;
  description: string;
  command: string;
  serviceNames: readonly string[];
  containerNames: readonly string[];
  dashboardUrl: string;
  stateDirName: string;
  gradient: string;
  /** Override for the upstream state/install home. Empty = `~/<stateDirName>`. */
  homeDir?: string;
  /** Health endpoint path on `dashboardUrl`. Default "/health"; 9Router answers
   *  at "/api/health" and 404s the default, which would read as unhealthy. */
  healthPath?: string;
  /** false = the command's mere presence proves nothing about the install.
   *  9Router's `command` is a wrapper script SHIPPED IN THIS REPO, so it exists
   *  on every checkout — detection must rest on its container alone, or an
   *  uninstalled 9Router reads as "package" and Install is refused forever. */
  commandProvesInstall?: boolean;
  /** Optional host port intentionally exposed by this managed runtime. MSO uses it
   *  only to advertise a direct, separate-origin UI when this machine has a
   *  globally routable IPv4 address. It is never used as the internal health
   *  target, and it does not imply that a domain exists. */
  publicPort?: number;
  /** Existing browser-facing URL owned by this application/deployment, e.g.
   *  https://9-router.example.com. When valid, this is preferred over generated
   *  managed-app hosts and public-IP fallbacks. */
  publicUrl?: string;
}

export interface ManagedAppView {
  id: ManagedAppId;
  name: string;
  description: string;
  installed: boolean;
  installationType: "systemd" | "docker" | "package" | "not-installed";
  state: ManagedAppState;
  healthy: boolean | null;
  version: string | null;
  dashboardAvailable: boolean;
  /** Preferred browser-facing URL outside the MSO cockpit: an explicit configured
   *  application domain when present, otherwise a public-IP:port fallback. null for
   *  loopback-only apps/hosts. This is never the trusted internal health target. */
  publicDashboardUrl: string | null;
  supportedActions: ManagedAppAction[];
  /** Why this reading may be wrong, when MSO knows that it might be.
   *
   *  "not-installed" is normally a fact. It is a GUESS when MSO cannot reach the
   *  user's systemd bus, because both apps run as systemd USER units and that is
   *  the only place their presence is visible. Saying "not installed" flatly then
   *  sends the operator to an Install button whose job fails at the same step
   *  every time — which is exactly what happened in production. `null` when the
   *  reading is trustworthy. */
  diagnostic: string | null;
}

export interface ManagedAppLogs {
  available: boolean;
  entries: string[];
}

/** A long-running, service-restarting operation. Never a lifecycle action: those
 *  finish inside one request, these do not (`openclaw update`'s own default step
 *  timeout is 1800 s). `restore` runs in-process and spawns nothing. `install`
 *  is the longest of them — Hermes fetches a Python toolchain before it starts. */
export const MANAGED_APP_JOB_KINDS = ["install", "update", "uninstall", "restore"] as const;
export type ManagedAppJobKind = (typeof MANAGED_APP_JOB_KINDS)[number];

export const MANAGED_APP_JOB_STATUSES = ["queued", "running", "succeeded", "failed", "interrupted"] as const;
export type ManagedAppJobStatus = (typeof MANAGED_APP_JOB_STATUSES)[number];

export interface ManagedAppJob {
  /** 24 lowercase hex chars. Also the record's filename — validate before use. */
  id: string;
  applicationId: ManagedAppId;
  kind: ManagedAppJobKind;
  /** argv as spawned: `argv[0]` is the program, the rest are execve arguments —
   *  no shell is ever involved. `[]` = no child (a `prepare`-only job). */
  argv: string[];
  status: ManagedAppJobStatus;
  startedAt: string;
  /** Set on every terminal status. For `interrupted` it is when the death was
   *  NOTICED, not when it happened — nobody was alive to record that. */
  endedAt: string | null;
  /** Child exit code. `null` while running, when a signal killed it, and for a
   *  job that never spawned. */
  exitCode: number | null;
  /** One redacted line explaining a `failed` / `interrupted` status. */
  error: string | null;
  /** Redacted combined stdout+stderr, capped (`MANAGED_APP_JOB_LOG_CAP`) to the
   *  TAIL. In a `since` read this holds only the chars after that offset. */
  log: string;
  /** Total chars ever appended — monotonic, so it stays a valid `since` cursor
   *  after the cap has dropped the head. `> log.length` once truncation began. */
  logOffset: number;
  /** Random per-server-process id. A record naming a runner that is gone was
   *  killed with it: the child never outlives the server (see jobs.ts). */
  runnerId: string;
  /** pid of the mso process that owns the job — NOT the child's. */
  serverPid: number;
  /** Last write. A running job heartbeats, so this doubles as liveness. */
  updatedAt: string;
}

/** History rows: the log is dropped so a list is not 20 × 256 KB. */
export type ManagedAppJobSummary = Omit<ManagedAppJob, "log">;

export interface StartManagedAppJobOptions {
  applicationId: ManagedAppId;
  kind: ManagedAppJobKind;
  /** `argv[0]` is the program; every element reaches execve as-is, never a
   *  shell. Omit/empty = no child at all, `prepare` is the whole job. */
  argv?: readonly string[];
  /** Runs first, inside the lock, before anything spawns. THROW TO ABORT: the
   *  job ends `failed` and argv never runs — which is how a mandatory
   *  pre-update backup gates the update it is protecting. */
  prepare?: (append: (text: string) => void) => Promise<void>;
  cwd?: string;
  /** Merged over the scrubbed child env (`childEnv()`). Non-interactive
   *  switches only — the log is user-visible, so never a credential. */
  env?: Record<string, string>;
  /** Wall clock for the child, clamped to 60 s … 1 h. Default 30 min, which is
   *  OpenClaw's own default step timeout. */
  timeoutMs?: number;
}

export interface ManagedAppFeature {
  id: string;
  applicationId: ManagedAppId;
  title: string;
  route: string;
  source: "route-manifest" | "nav-bundle" | "plugin-api";
  available: boolean;
}
