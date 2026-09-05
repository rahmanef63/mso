import { startArtifactMaintenance } from "./artifact-cleanup";
import { promises as fs } from "node:fs";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { principalHash, readSessionFile } from "./session-files";
import { ARTIFACT_LIMITS, artifactLocation, artifactPaths, type ArtifactOwner } from "./artifact-paths";
import { SESSION_ID } from "./session-paths";
import { ensureArtifactDirectory } from "./artifact-io";
import { readArtifactManifest, writeArtifactManifest } from "./artifact-manifest";
export async function ownedArtifactSession(principal: string | undefined, sessionId: string | undefined): Promise<ArtifactOwner> {
  if (!principal || !sessionId) throw new Error("artifacts require an authenticated MSO session");
  const row = await readSessionFile(sessionId);
  if (!row || row.principalHash !== principalHash(principal)) throw new Error("artifact session not found for this client");
  return { id: row.id, principalHash: row.principalHash };
}
export async function checkedArtifactOwner(owner: ArtifactOwner) {
  const row = await readSessionFile(owner.id);
  if (!row || row.principalHash !== owner.principalHash) throw new Error("artifact session owner mismatch");
  return artifactPaths(owner);
}
export async function artifactDirectories(owner: ArtifactOwner) {
  const p = await checkedArtifactOwner(owner);
  startArtifactMaintenance();
  for (const directory of [p.incoming, p.screenshots, p.reports]) await ensureArtifactDirectory(directory, p.root);
  return p;
}
export async function prepareSessionArtifacts(owner: ArtifactOwner) {
  const p = await artifactDirectories(owner);
  await withSecurityStoreLock(p.lock, async () => {
    const m = await readArtifactManifest(owner);
    m.leaseUntil = new Date(Date.now() + 30 * 60_000).toISOString();
    m.updatedAt = new Date().toISOString();
    await writeArtifactManifest(owner, m);
  });
  return artifactLocation(owner);
}
export async function sessionArtifactEnvironment(context: { principal?: string; sessionId?: string }): Promise<Record<string, string>> {
  if (!context.principal || !context.sessionId) return {};
  const location = await prepareSessionArtifacts(await ownedArtifactSession(context.principal, context.sessionId));
  return {
    MSO_SESSION_ID: context.sessionId,
    MSO_SESSION_TEMP_DIR: location.directory,
    MSO_SCREENSHOT_DIR: location.incomingDirectory,
    MSO_ARTIFACT_MANIFEST: location.manifestPath,
  };
}
export async function assertPrincipalArtifactQuota(owner: ArtifactOwner, incomingBytes: number) {
  const p = artifactPaths(owner);
  const names = (await fs.readdir(p.principal)).filter((n) => SESSION_ID.test(n));
  if (names.length > ARTIFACT_LIMITS.sessions) throw new Error("too many temporary artifact sessions; clean up expired sessions");
  let bytes = incomingBytes;
  for (const id of names) bytes += (await readArtifactManifest({ ...owner, id })).artifacts.reduce((n, a) => n + a.bytes, 0);
  if (bytes > ARTIFACT_LIMITS.principalBytes) throw new Error("principal artifact quota reached; clean up expired artifacts");
}
