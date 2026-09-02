// Pure MSO host adapter surface. React/session composition lives in os-shell.
export { rawUrl, zipUrl } from "./urls";
export type {
  OsApi, SysStats, FsEntry, FsList, FsRoot, FsUsage, FsHit, UploadFile, UploadResult,
  UploadProgress, ExecResult, Process, HostAccess, HostAccessRole, ServiceScope, ServiceAction,
  SystemService, ServiceInventory, ServiceLogs, PackageUpdate, PackageUpdateSummary,
} from "./types";
