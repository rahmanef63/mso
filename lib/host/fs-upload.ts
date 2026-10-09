// SERVER-ONLY. Upload writers behind /api/v1/fs/upload. Writes follow WRITE
// roots (see paths.ts); each part is validated by assertUploadTarget, which
// enforces the SAME credential/sensitive denylist + realpath-bounds as
// writeFile/move/copy (so an upload can't write ~/.ssh/authorized_keys or escape
// the dest through a symlinked subdir). Split out of fs.ts for single responsibility.
import { promises as fs } from "fs";
import { randomBytes } from "crypto";
import path from "path";
import { HostError } from "./host-error";
import { assertUploadTarget, safeWritePath } from "./paths";
import { pinDirectory, type PinnedDirectory } from "./fs-descriptors";

const MAX_UPLOAD = 100 * 1024 * 1024; // 100 MiB per file

// Binary-safe batch upload into an EXISTING dir (within WRITE roots). Each item's
// relPath may carry folders ("imgs/a.png") — intermediate dirs are created. Path
// segments are sanitised (no "", ".", ".."), so an item can't escape `dest`.
export async function uploadInto(
  dest: string,
  files: { relPath: string; data: Uint8Array }[],
  options: { overwrite?: boolean } = {},
): Promise<{ written: number; failed: string[] }> {
  const destReal = await resolveUploadDest(dest);

  const failed: string[] = [];
  let written = 0;
  for (const { relPath, data } of files) {
    const segs = sanitiseSegments(relPath);
    if (!segs.length) { failed.push(relPath); continue; }
    if (data.byteLength > MAX_UPLOAD) { failed.push(`${relPath} (too large)`); continue; }
    const full = path.join(destReal, ...segs);
    try {
      await assertUploadTarget(full, destReal);
    } catch {
      failed.push(relPath);
      continue;
    }
    let parent: PinnedDirectory | undefined, tmp: string | undefined;
    try {
      parent = await pinDirectory(path.dirname(full), true, true);
      const target = await parent.child(path.basename(full));
      tmp = privateTempPath(target);
      await fs.writeFile(tmp, data, { mode: 0o600, flag: "wx" });
      await fs.chmod(tmp, 0o644);
      const destination = await parent.child(path.basename(full));
      if (options.overwrite === false) await fs.link(tmp, destination);
      else await fs.rename(tmp, destination);
      written++;
    } catch {
      failed.push(relPath);
    } finally {
      if (tmp) await fs.rm(tmp, { force: true }).catch(() => {});
      await parent?.handle.close();
    }
  }
  return { written, failed };
}

// Resolve + validate an EXISTING upload destination dir within WRITE roots. Done
// up-front (before the body is read) so a bad dest fails fast, and so the route
// never has to touch lib/host/paths directly.
export async function resolveUploadDest(dest: string): Promise<string> {
  const destReal = await safeWritePath(dest, true);
  if (!(await fs.stat(destReal)).isDirectory()) throw new HostError("Destination is not a directory");
  const held = await pinDirectory(destReal, true);
  await held.handle.close();
  return destReal;
}

// Stream ONE file part (relPath + byte stream) into a pre-resolved dest dir.
// Spools to a .tmp via fs.createWriteStream (never a full Buffer in RAM), then
// atomic-renames. Aborts past MAX_UPLOAD, cleaning the tmp. Path segments are
// sanitised so a part can't escape `destReal`. The body iterator is ALWAYS fully
// drained (even on abort) so the multipart parser can advance to the next part.
// Returns ok|too-large|bad-path.
export async function streamFileInto(
  destReal: string,
  relPath: string,
  body: AsyncIterable<Uint8Array>,
): Promise<"ok" | "too-large" | "bad-path"> {
  const segs = sanitiseSegments(relPath);
  if (!segs.length) { await drain(body); return "bad-path"; }
  const full = path.join(destReal, ...segs);
  try {
    await assertUploadTarget(full, destReal);
  } catch {
    await drain(body);
    return "bad-path";
  }

  let parent: PinnedDirectory;
  try { parent = await pinDirectory(path.dirname(full), true, true); }
  catch { await drain(body); return "bad-path"; }
  let tmp: string | undefined, handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let bytes = 0, tooLarge = false, failed = false;
  try {
    tmp = privateTempPath(await parent.child(path.basename(full)));
    try { handle = await fs.open(/* turbopackIgnore: true */ tmp, "wx", 0o600); } catch { failed = true; }
    for await (const chunk of body) {
      if (tooLarge || failed) continue;
      bytes += chunk.byteLength;
      if (bytes > MAX_UPLOAD) { tooLarge = true; continue; }
      try { await handle!.writeFile(chunk); } catch { failed = true; }
    }
    if (tooLarge) return "too-large";
    if (failed) throw new HostError("Failed to write upload");
    await handle!.chmod(0o644);
    await handle!.close(); handle = undefined;
    await fs.rename(tmp, await parent.child(path.basename(full)));
    return "ok";
  } finally {
    await handle?.close().catch(() => undefined);
    if (tmp) await fs.rm(tmp, { force: true }).catch(() => undefined);
    await parent.handle.close();
  }
}

function privateTempPath(full: string): string {
  return `${full}.mso-upload-${process.pid}-${randomBytes(8).toString("hex")}.tmp`;
}

function sanitiseSegments(relPath: string): string[] {
  if (!relPath || relPath.length > 1024 || relPath.includes("\0")) return [];
  const segments = relPath.split("/").map((segment) => segment.trim());
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.length > 255)) return [];
  return segments;
}

async function drain(body: AsyncIterable<Uint8Array>): Promise<void> {
  for await (const _chunk of body) void _chunk; // discard remaining bytes
}
