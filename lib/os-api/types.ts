// os-rr Cloud API contract — the single boundary between the OS and the VPS.
// The OsApi PORT + host data types now live in the appshell framework
// (appshell/lib/host-api) so app slices import them via a legal alias; this
// module keeps the mso CONFIG + the concrete adapters (http/mock) that
// satisfy the port. MockAdapter simulates in-browser; HttpAdapter calls the agent.
export const API_VERSION = "v1";

export type {
  Unsub,
  HostAccessRole,
  HostAccess,
  SysStats,
  FsEntry,
  FsRoot,
  FsList,
  FsUsage,
  FsHit,
  UploadFile,
  UploadResult,
  UploadProgress,
  ExecResult,
  Process,
  ServiceScope,
  ServiceAction,
  SystemService,
  ServiceInventory,
  ServiceLogs,
  PackageUpdate,
  PackageUpdateSummary,
  AppManifest,
  OsApi,
} from "@/features/appshell";
