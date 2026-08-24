// Host facade — the single import for /api/v1 route handlers. All host access
// (fs/exec/sys) is LOCAL: mso runs as a host process, so it touches the
// filesystem and spawns commands directly. No external agent. Bounds + auth
// live in paths.ts and the route's verifyAuth() gate.
export { listDir, readFile, writeFile, makeDir, remove, move, copy, searchFs, usage, statReadable, fileStream } from "./fs";
export { uploadInto, resolveUploadDest, streamFileInto } from "./fs-upload";
export { zipStream } from "./fs-zip";
export { parseMultipart, boundaryFromContentType, UploadTooLargeError } from "./multipart";
export type { MultipartPart } from "./multipart";
export { runCommand } from "./exec";
export { sha256Text, utf8Bytes } from "./hash";
export { writeFileGuarded } from "./guarded-write";
export { resolveProjectHint, inspectProject } from "./projects";
export { projectCapabilities, runProjectFunction } from "./project-capabilities";
export type { ProjectCapabilities, PublicProjectFunction } from "./project-capabilities";
export { listProjects, listProjectDirs, projectRoots, PROJECT_LIMITS } from "./project-roots";
export type { ProjectRow, ListProjectsResult } from "./project-roots";
export { normalizeProjectKey, projectAliasesFor, projectAliasTarget } from "./project-aliases";
export type { ProjectResolution } from "./projects";
export { openPty, attachPty, writePty, resizePty, closePty, hasPty } from "./pty";
export { stats, processes } from "./sys";
export { captureMsoScreen } from "./screenshot";
export type { ScreenshotShell, ScreenshotResult } from "./screenshot";
export { audit, readAuditTail } from "./audit";
export { createTempShare, inspectTempShare, consumeTempShare, revokeTempShare, tempShareUrl } from "./temp-share";
export type { TempShareInfo, ConsumedTempShare } from "./temp-share";
export type { AuditAction, AuditEntry, AuditRecord } from "./audit";
export { rateLimited, rateLimitedUntrusted } from "./rate-limit";
export { HostError } from "./host-error";
export { apiError, readJson, requireString, optionalString, requireInt, invalidRequest } from "./api-error";
