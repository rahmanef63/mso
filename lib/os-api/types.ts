// Concrete MSO adapters implement the transport-neutral host I/O contract.
export const API_VERSION = "v1";
export type {
  Unsub, HostAccessRole, HostAccess, SysStats, FsEntry, FsRoot, FsList, FsUsage, FsHit,
  UploadFile, UploadResult, UploadProgress, ExecResult, Process, ServiceScope, ServiceAction,
  SystemService, ServiceInventory, ServiceLogs, PackageUpdate, PackageUpdateSummary, AppManifest,
  ManagedAppSummary, ManagedAppAction, BrowserState, OsApi,
} from "@/lib/contracts/os-api";
