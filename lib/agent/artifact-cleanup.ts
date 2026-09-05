import path from "node:path";
import { promises as fs } from "node:fs";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { readSessionFile, listSessionRecords, principalHash } from "./session-files";
import { artifactPaths, artifactRetentionDays, type ArtifactOwner } from "./artifact-paths";
import { ensureArtifactDirectory } from "./artifact-io";
import { readArtifactManifest, ARTIFACT_FILE } from "./artifact-manifest";

/** Retention never recursively traverses an arbitrary directory. A corrupt manifest,
 * unknown file, symlink or recently active session causes a fail-closed skip. */
export async function pruneSessionArtifacts(owner: ArtifactOwner, dryRun = true, now = Date.now()) {
  const p = artifactPaths(owner);
  if (!(await ensureArtifactDirectory(p.directory, p.root, false))) return { sessionId: owner.id, state: "absent", bytes: 0 };
  return withSecurityStoreLock(p.ownerLock, () =>
    withSecurityStoreLock(p.lock, async () => {
      const session = await readSessionFile(owner.id),
        m = await readArtifactManifest(owner);
      if (!session || session.principalHash !== owner.principalHash) throw new Error("artifact owner mismatch");
      const latest = Math.max(Date.parse(session.updatedAt), Date.parse(m.updatedAt));
      if (Date.parse(m.leaseUntil) > now || now - latest < artifactRetentionDays() * 86400000)
        return { sessionId: owner.id, state: "active", bytes: 0 };
      const rootEntries = await fs.readdir(p.directory);
      if (rootEntries.some((n) => !["incoming", "screenshots", "reports", "manifest.json"].includes(n)))
        return { sessionId: owner.id, state: "unknown-files", bytes: 0 };
      const files: string[] = [];
      let bytes = 0;
      for (const dir of [p.incoming, p.screenshots, p.reports]) {
        if (!(await ensureArtifactDirectory(dir, p.root, false))) continue;
        const names = await fs.readdir(dir);
        if (names.length > 500) return { sessionId: owner.id, state: "too-many-files", bytes: 0 };
        for (const name of names) {
          const known =
            dir === p.incoming ? /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,179}\.(png|jpe?g|webp|json)$/.test(name) : ARTIFACT_FILE.test(name);
          const file = path.join(dir, name),
            stat = await fs.lstat(file);
          if (
            !known ||
            name.includes("..") ||
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.nlink !== 1 ||
            (stat.mode & 0o077) !== 0 ||
            (typeof process.getuid === "function" && stat.uid !== process.getuid())
          )
            return { sessionId: owner.id, state: "unsafe-files", bytes: 0 };
          if (now - stat.mtimeMs < artifactRetentionDays() * 86400000) return { sessionId: owner.id, state: "recent-files", bytes: 0 };
          files.push(file);
          bytes += stat.size;
        }
      }
      if (dryRun) return { sessionId: owner.id, state: "would-remove", bytes, files: files.length };
      for (const file of files) await fs.unlink(file);
      for (const dir of [p.incoming, p.screenshots, p.reports])
        await fs.rmdir(dir).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      await fs.unlink(p.manifest).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await fs.rmdir(p.directory);
      return { sessionId: owner.id, state: "removed", bytes, files: files.length };
    }),
  );
}
export async function cleanupSessionArtifacts(options: { principal?: string; currentSessionId?: string; dryRun?: boolean } = {}) {
  const owner = options.principal ? principalHash(options.principal) : undefined;
  const sessions = (await listSessionRecords())
    .filter((s) => (!owner || s.principalHash === owner) && s.id !== options.currentSessionId)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const candidates = [];
  for (const session of sessions) {
    const p = artifactPaths(session);
    if (
      await fs.lstat(p.directory).then(
        () => true,
        () => false,
      )
    )
      candidates.push(session);
  }
  const results = [];
  for (const session of candidates.slice(0, 100)) {
    try {
      results.push(await pruneSessionArtifacts(session, options.dryRun !== false));
    } catch {
      results.push({ sessionId: session.id, state: "unsafe-or-busy", bytes: 0 });
    }
  }
  return {
    dryRun: options.dryRun !== false,
    retentionDays: artifactRetentionDays(),
    checked: results.length,
    remaining: Math.max(0, candidates.length - results.length),
    results,
  };
}
let started = false;
export function startArtifactMaintenance() {
  if (started || process.env.VITEST || process.env.NODE_ENV !== "production") return;
  started = true;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await cleanupSessionArtifacts({ dryRun: false });
    } finally {
      running = false;
    }
  };
  void run().catch(() => undefined);
  setInterval(() => void run().catch(() => undefined), 30 * 60_000).unref();
}
