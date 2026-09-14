import { createHash, randomUUID } from "crypto";
import { promises as fs, constants as fsConstants } from "fs";
import path from "path";
import { HostError } from "./host-error";
import { assertUploadTarget } from "./paths";
import { resolveUploadDest } from "./fs-upload";

export type UploadConflictPolicy = "error" | "rename" | "replace";
export type GuardedUploadResult = {
  path: string;
  filename: string;
  status: "created" | "unchanged" | "renamed" | "replaced";
  sha256: string;
  previousSha256?: string;
};

const SHA_RE = /^[a-f0-9]{64}$/i;
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

function safeName(name: string): string {
  if (!name || path.basename(name) !== name || name.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new HostError("filename is invalid");
  }
  return name;
}

async function existingHash(full: string): Promise<string | null> {
  let handle;
  try {
    handle = await fs.open(full, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw new HostError("Refusing symlink file");
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new HostError("Destination exists but is not a regular file");
    const digest = createHash("sha256"), chunk = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < stat.size) {
      const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, stat.size - offset), offset);
      if (!bytesRead) break;
      digest.update(chunk.subarray(0, bytesRead));
      offset += bytesRead;
    }
    return digest.digest("hex");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function renamed(name: string, sha256: string): string {
  const ext = path.extname(name), stem = path.basename(name, ext), suffix = sha256.slice(0, 16);
  const maxStem = Math.max(1, 200 - ext.length - suffix.length - 2);
  return `${stem.slice(0, maxStem)}.${suffix}${ext}`;
}

async function createExclusive(full: string, data: Uint8Array): Promise<boolean> {
  const tmp = `${full}.mso-upload-${process.pid}-${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, data, { mode: 0o600, flag: "wx" });
    await fs.chmod(tmp, 0o644);
    await fs.link(tmp, full);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

async function replaceAtomic(full: string, data: Uint8Array): Promise<void> {
  const tmp = `${full}.mso-upload-${process.pid}-${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, data, { mode: 0o600, flag: "wx" });
    await fs.chmod(tmp, 0o644);
    await fs.rename(tmp, full);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

export async function uploadOneGuarded(input: {
  dest: string; filename: string; data: Uint8Array;
  conflict?: UploadConflictPolicy; expectedSha256?: string;
}): Promise<GuardedUploadResult> {
  const destReal = await resolveUploadDest(input.dest), filename = safeName(input.filename);
  const full = path.join(destReal, filename), sha256 = hash(input.data), policy = input.conflict ?? "error";
  await assertUploadTarget(full, destReal);
  await fs.mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
  await assertUploadTarget(full, destReal);

  let previous = await existingHash(full);
  if (previous === null) {
    if (policy === "replace") throw new HostError("replace requires an existing destination and expected_sha256");
    if (await createExclusive(full, input.data)) return { path: full, filename, status: "created", sha256 };
    previous = await existingHash(full);
  }
  if (previous === sha256) return { path: full, filename, status: "unchanged", sha256, previousSha256: previous };
  if (policy === "error") throw new HostError("destination already exists with different content; choose rename or guarded replace");

  if (policy === "rename") {
    const alternate = renamed(filename, sha256), alternateFull = path.join(/*turbopackIgnore: true*/ destReal, alternate);
    await assertUploadTarget(alternateFull, destReal);
    const alternateHash = await existingHash(alternateFull);
    if (alternateHash === sha256) return { path: alternateFull, filename: alternate, status: "unchanged", sha256, previousSha256: alternateHash };
    if (alternateHash !== null || !(await createExclusive(alternateFull, input.data))) throw new HostError("deterministic renamed destination already exists with different content");
    return { path: alternateFull, filename: alternate, status: "renamed", sha256, previousSha256: previous ?? undefined };
  }

  const expected = input.expectedSha256?.toLowerCase();
  if (!expected || !SHA_RE.test(expected)) throw new HostError("replace requires expected_sha256 from a prior read/export");
  if (previous !== expected) throw new HostError("destination changed since inspection; refresh its SHA-256 before replacing");
  const rechecked = await existingHash(full);
  if (rechecked !== expected) throw new HostError("destination changed during replacement; retry only after a fresh read/export");
  await replaceAtomic(full, input.data);
  return { path: full, filename, status: "replaced", sha256, previousSha256: previous ?? undefined };
}
