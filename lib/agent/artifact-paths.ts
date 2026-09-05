import path from "node:path";
import { agentSessionsDir, SESSION_ID } from "./session-paths";
export const ARTIFACT_LIMITS = {
  fileBytes: 12 * 1024 * 1024,
  sessionBytes: 128 * 1024 * 1024,
  principalBytes: 1024 * 1024 * 1024,
  files: 200,
  sessions: 128,
} as const;
export function artifactRetentionDays(): number {
  const n = Number(process.env.OS_AGENT_ARTIFACT_RETENTION_DAYS || 7);
  return Number.isFinite(n) ? Math.max(1, Math.min(30, Math.trunc(n))) : 7;
}
export type ArtifactOwner = { id: string; principalHash: string };
export function artifactPaths(owner: ArtifactOwner) {
  if (!SESSION_ID.test(owner.id) || !/^[a-f0-9]{64}$/.test(owner.principalHash)) throw new Error("invalid artifact owner/session");
  const root = agentSessionsDir(),
    temp = path.join(root, "temp");
  const principal = path.join(temp, owner.principalHash),
    directory = path.join(principal, owner.id);
  return {
    root,
    temp,
    principal,
    directory,
    incoming: path.join(directory, "incoming"),
    screenshots: path.join(directory, "screenshots"),
    reports: path.join(directory, "reports"),
    manifest: path.join(directory, "manifest.json"),
    lock: path.join(principal, `.${owner.id}.artifacts`),
    ownerLock: path.join(temp, `.${owner.principalHash}.quota`),
  };
}
export function artifactLocation(owner: ArtifactOwner) {
  const p = artifactPaths(owner);
  return {
    directory: p.directory,
    incomingDirectory: p.incoming,
    screenshotsDirectory: p.screenshots,
    manifestPath: p.manifest,
    retentionDays: artifactRetentionDays(),
    limits: ARTIFACT_LIMITS,
    readTool: "session_artifacts",
    registerTool: "session_artifact_register",
  };
}
