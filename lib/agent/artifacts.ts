import path from "node:path";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { redactText } from "@/lib/security/redact-text";
import { ARTIFACT_LIMITS, artifactLocation, type ArtifactOwner } from "./artifact-paths";
import { ensureArtifactDirectory, readArtifactBytes } from "./artifact-io";
import { readArtifactManifest, writeArtifactManifest, ARTIFACT_ID } from "./artifact-manifest";
import { artifactFormat, artifactMetadata, artifactName } from "./artifact-policy";
import { artifactDirectories, checkedArtifactOwner, assertPrincipalArtifactQuota } from "./artifact-session";
import type { ArtifactInput, SessionArtifact } from "./artifact-types";
export async function saveSessionArtifact(owner: ArtifactOwner, bytes: Buffer, input: ArtifactInput): Promise<SessionArtifact> {
  if (!bytes.length || bytes.length > ARTIFACT_LIMITS.fileBytes) throw new Error("artifact exceeds 12 MiB");
  const format = artifactFormat(bytes),
    meta = artifactMetadata(input);
  if (format.kind === "report") {
    const text = bytes.toString("utf8");
    if (redactText(text, text.length) !== text) throw new Error("report contains credential-shaped content; redact before saving");
  }
  const p = await artifactDirectories(owner);
  return withSecurityStoreLock(p.ownerLock, () =>
    withSecurityStoreLock(p.lock, async () => {
      const m = await readArtifactManifest(owner);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const existing = m.artifacts.find(
        (a) =>
          a.sha256 === digest &&
          a.project === meta.project &&
          a.feature === meta.feature &&
          a.environment === meta.environment &&
          a.locale === meta.locale &&
          a.width === meta.width &&
          a.height === meta.height &&
          a.url === meta.url &&
          a.workflowId === meta.workflowId,
      );
      if (existing) return existing;
      if (
        m.artifacts.length >= ARTIFACT_LIMITS.files ||
        m.artifacts.reduce((n, a) => n + a.bytes, 0) + bytes.length > ARTIFACT_LIMITS.sessionBytes
      )
        throw new Error("session artifact quota reached");
      await assertPrincipalArtifactQuota(owner, bytes.length);
      const now = new Date(),
        { id, filename } = artifactName(meta, format.extension, now);
      const relativePath = (format.kind === "screenshot" ? "screenshots/" : "reports/") + filename;
      const entry: SessionArtifact = {
        ...meta,
        id,
        filename,
        relativePath,
        kind: format.kind,
        mimeType: format.mimeType,
        bytes: bytes.length,
        sha256: digest,
        createdAt: now.toISOString(),
      };
      const target = path.join(p.directory, relativePath);
      await fs.writeFile(target, bytes, { flag: "wx", mode: 0o600 });
      try {
        m.artifacts.push(entry);
        m.updatedAt = now.toISOString();
        await writeArtifactManifest(owner, m);
      } catch (error) {
        await fs.unlink(target).catch(() => undefined);
        throw error;
      }
      return entry;
    }),
  );
}
export async function registerIncomingArtifact(owner: ArtifactOwner, source: string, input: ArtifactInput): Promise<SessionArtifact> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,179}\.(png|jpe?g|webp|json)$/.test(source) || source.includes(".."))
    throw new Error("source must be one filename inside MSO_SCREENSHOT_DIR");
  const p = await checkedArtifactOwner(owner);
  await ensureArtifactDirectory(p.incoming, p.root, false);
  const sourcePath = path.join(p.incoming, source),
    bytes = await readArtifactBytes(sourcePath, ARTIFACT_LIMITS.fileBytes);
  const entry = await saveSessionArtifact(owner, bytes, input);
  // Staged input is deliberately retained: never unlink a concurrently replaced producer file.
  // Dormant-session cleanup handles it together with the registered copy.
  return entry;
}
export async function listSessionArtifacts(owner: ArtifactOwner, offset = 0, limit = 50) {
  const p = await checkedArtifactOwner(owner),
    m = await readArtifactManifest(owner);
  const start = Math.max(0, Math.trunc(offset) || 0),
    count = Math.max(1, Math.min(100, Math.trunc(limit) || 50));
  return {
    sessionId: owner.id,
    ...artifactLocation(owner),
    total: m.artifacts.length,
    bytes: m.artifacts.reduce((n, a) => n + a.bytes, 0),
    artifacts: m.artifacts.slice(start, start + count).map((a) => ({ ...a, path: path.join(p.directory, a.relativePath) })),
    nextOffset: start + count < m.artifacts.length ? start + count : null,
  };
}
export async function readSessionArtifact(owner: ArtifactOwner, id: string) {
  if (!ARTIFACT_ID.test(id)) throw new Error("invalid artifact id");
  const p = await checkedArtifactOwner(owner);
  if (!(await ensureArtifactDirectory(p.directory, p.root, false))) throw new Error("artifact expired or not found");
  return withSecurityStoreLock(p.lock, async () => {
    const m = await readArtifactManifest(owner),
      entry = m.artifacts.find((a) => a.id === id);
    if (!entry) throw new Error("artifact expired or not found");
    await ensureArtifactDirectory(path.join(p.directory, path.dirname(entry.relativePath)), p.root, false);
    const bytes = await readArtifactBytes(path.join(p.directory, entry.relativePath), ARTIFACT_LIMITS.fileBytes);
    if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error("artifact checksum mismatch");
    return { entry, path: path.join(p.directory, entry.relativePath), bytes };
  });
}
