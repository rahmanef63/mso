import { artifactPaths, ARTIFACT_LIMITS, type ArtifactOwner } from "./artifact-paths";
import { emptyArtifactManifest, type ArtifactManifest, type SessionArtifact } from "./artifact-types";
import { readLocalAgentStore, writeLocalAgentStore } from "./local-agent-private-store";
import { ensureArtifactDirectory, readArtifactBytes } from "./artifact-io";
export const ARTIFACT_ID = /^shot_[a-f0-9]{24}$/;
export const ARTIFACT_FILE = /^mso__[a-z0-9_.-]{1,210}\.(png|jpg|webp|json)$/;
function validEntry(value: SessionArtifact): boolean {
  return Boolean(
    value &&
    ARTIFACT_ID.test(value.id) &&
    ARTIFACT_FILE.test(value.filename) &&
    !value.filename.includes("..") &&
    ["screenshots/" + value.filename, "reports/" + value.filename].includes(value.relativePath) &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    Number.isInteger(value.bytes) &&
    value.bytes > 0 &&
    value.bytes <= ARTIFACT_LIMITS.fileBytes &&
    ["image/png", "image/jpeg", "image/webp", "application/json"].includes(value.mimeType) &&
    Number.isFinite(Date.parse(value.createdAt)),
  );
}
export async function readArtifactManifest(owner: ArtifactOwner): Promise<ArtifactManifest> {
  const p = artifactPaths(owner);
  if (!(await ensureArtifactDirectory(p.directory, p.root, false))) return emptyArtifactManifest(owner);
  // Existing shared JSON writer is reused; this adds the artifact-specific hard-link guard.
  await readArtifactBytes(p.manifest, 768 * 1024).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT") throw e;
  });
  return readLocalAgentStore(p.manifest, 768 * 1024, emptyArtifactManifest(owner), (value): value is ArtifactManifest => {
    const m = value as ArtifactManifest;
    return Boolean(
      m &&
      m.version === 1 &&
      m.sessionId === owner.id &&
      m.principalHash === owner.principalHash &&
      Number.isFinite(Date.parse(m.updatedAt)) &&
      Number.isFinite(Date.parse(m.leaseUntil)) &&
      Array.isArray(m.artifacts) &&
      m.artifacts.length <= ARTIFACT_LIMITS.files &&
      m.artifacts.every(validEntry) &&
      new Set(m.artifacts.map((a) => a.id)).size === m.artifacts.length,
    );
  });
}
export async function writeArtifactManifest(owner: ArtifactOwner, value: ArtifactManifest) {
  const p = artifactPaths(owner);
  await ensureArtifactDirectory(p.directory, p.root);
  await writeLocalAgentStore(p.manifest, value, 768 * 1024);
}
