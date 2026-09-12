import path from "node:path";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { readBoundedRegularBuffer } from "./bounded-read";
import { assertUploadTarget } from "./paths";
import { uploadInto, resolveUploadDest } from "./fs-api";
export async function attachProjectAsset(projectPath: string, relativePath: string, bytes: Buffer, mimeType: string) {
  const parts = relativePath.split("/");
  if (!relativePath || relativePath.length > 1024 || parts.some(p => !p || p === "." || p === ".." || p.trim() !== p || /[\\\x00-\x1f]/.test(p))) throw new Error("asset path must stay inside the project");
  const extensions: Record<string, string[]> = { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/webp": [".webp"], "application/json": [".json"] };
  if (!extensions[mimeType]?.includes(path.extname(relativePath).toLowerCase())) throw new Error("asset extension must match its MIME type");
  const directory = await resolveUploadDest(projectPath), target = path.join(directory, ...parts);
  await assertUploadTarget(target, directory);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return withSecurityStoreLock(target, async () => {
    const stat = await fs.lstat(target).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
    let unchanged = false;
    if (stat) {
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("unsafe asset target");
      const current = await readBoundedRegularBuffer(target, 12 * 1024 * 1024);
      if (!current || createHash("sha256").update(current).digest("hex") !== sha256) throw new Error("asset already exists with different content; choose another path");
      unchanged = true;
    } else {
      const result = await uploadInto(directory, [{ relPath: relativePath, data: bytes }], { overwrite: false });
      if (result.written !== 1) throw new Error("asset could not be created safely; inspect the destination");
    }
    return { path: target, relativePath, sha256, bytes: bytes.length, mimeType, unchanged, retention: "project-owned; independent of temporary session cleanup" };
  });
}
