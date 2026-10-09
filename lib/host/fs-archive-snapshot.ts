import { promises as fs } from "node:fs";
import path from "node:path";
import { descriptorPath, openReadableHandle, pinDirectory, type PinnedDirectory } from "./fs-descriptors";
import { isCredentialPath } from "./path-credentials";
import { HostError } from "./host-error";

/** Zip walks only this private snapshot; every source read holds a verified descriptor. */
export async function snapshotArchive(base: string, names: string[], exclude: string[], destination: string): Promise<void> {
  const excluded = new Set(exclude), deadline = Date.now() + 60_000;
  let files = 0, bytes = 0;
  const charge = (size = 0) => {
    bytes += size;
    if (Date.now() > deadline) throw new HostError("Archive snapshot exceeded its time limit");
    if (files > 50_000) throw new HostError("Archive selection exceeds the 50000 file limit");
    if (bytes > 512 * 1024 * 1024) throw new HostError("Archive selection exceeds the 512 MiB input limit");
  };
  async function copy(parent: PinnedDirectory, name: string, dest: string): Promise<void> {
    charge();
    const real = await descriptorPath(parent.handle, false);
    if (excluded.has(name) || isCredentialPath(path.join(real, name))) return;
    const source = await parent.child(name);
    const stat = await fs.lstat(source).catch((error: NodeJS.ErrnoException) => {
      if (["ENOENT", "EACCES", "EPERM"].includes(error.code ?? "")) return null;
      throw error;
    });
    if (!stat) return;
    if (stat.isDirectory()) {
      const dir = await pinDirectory(source, false);
      try {
        await fs.mkdir(dest, {mode: 0o700});
        for (const child of await fs.readdir(`/proc/self/fd/${dir.handle.fd}`)) await copy(dir, child, path.join(dest, child));
      } finally { await dir.handle.close(); }
      return;
    }
    files++; charge();
    if (stat.isSymbolicLink()) {await fs.symlink(await fs.readlink(source), dest); return;}
    if (!stat.isFile()) return;
    const input = await openReadableHandle(source).catch((error: NodeJS.ErrnoException) => {
      if (["ENOENT", "EACCES", "EPERM"].includes(error.code ?? "")) return null;
      throw error;
    });
    if (!input) return;
    let output;
    try {
      if (!(await input.stat()).isFile()) throw new HostError("Archive source changed type");
      output = await fs.open(dest, "wx", 0o600);
      const chunk = Buffer.alloc(1024 * 1024);
      while (true) {
        const {bytesRead} = await input.read(chunk);
        if (!bytesRead) break;
        charge(bytesRead);
        await output.writeFile(chunk.subarray(0, bytesRead));
      }
    } finally {await input.close(); await output?.close();}
  }
  const root = await pinDirectory(base, false);
  try {for (const name of new Set(names)) await copy(root, name, path.join(destination, name));}
  finally {await root.handle.close();}
}
