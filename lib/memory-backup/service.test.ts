import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSnapshot, verifySnapshot } from "./service";
import { LIMITS, scanSources } from "./scan";
const roots: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-memory-backup-")); roots.push(root);
  const source = path.join(root, "source"); await fs.mkdir(source, { mode: 0o700 });
  await fs.writeFile(path.join(source, "note.md"), "A durable decision", { mode: 0o600 });
  return { root, source, destination: path.join(root, "backups") };
}
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
describe("private memory snapshots", () => {
  it("checksums exact copies and rehearses restore without changing sources", async () => {
    const f = await fixture(), before = await fs.readFile(path.join(f.source, "note.md"));
    const result = await createSnapshot([{ key: "memory", path: f.source }], f.destination);
    expect(result.state).toBe("snapshot"); expect(result.scan.files).toBe(1);
    const verified = await verifySnapshot(f.destination, result.id, result.manifestSha256);
    expect(verified).toMatchObject({ integrity: true, complete: true, restoredFiles: 1, sourceWritesPerformed: 0 });
    expect(await fs.readFile(path.join(f.source, "note.md"))).toEqual(before);
    expect(await fs.readFile(path.join(verified.restoreDirectory, "memory", "note.md"))).toEqual(before);
    expect((await fs.stat(path.join(verified.restoreDirectory, "memory", "note.md"))).mode & 0o777).toBe(0o600);
  });
  it("refuses altered files, wrong manifest checksums and traversal ids", async () => {
    const f = await fixture(), result = await createSnapshot([{ key: "memory", path: f.source }], f.destination);
    await expect(verifySnapshot(f.destination, result.id, "0".repeat(64))).rejects.toThrow("checksum");
    await expect(verifySnapshot(f.destination, "../escape", result.manifestSha256)).rejects.toThrow("id");
    await fs.writeFile(path.join(result.directory, "files", "memory", "note.md.gz"), "tampered");
    await expect(verifySnapshot(f.destination, result.id, result.manifestSha256)).rejects.toThrow();
  });
  it("labels incomplete source scans and refuses symlinks without following them", async () => {
    const f = await fixture(); await fs.symlink(path.join(f.source, "note.md"), path.join(f.source, "alias.md"));
    const result = await createSnapshot([{ key: "memory", path: f.source }], f.destination);
    expect(result.state).toBe("partial"); expect(result.scan.rejected).toBe(1);
    const limited = await scanSources([{ key: "memory", path: f.source }], { ...LIMITS, bytes: 1 });
    expect(limited.truncated).toBe(true);
  });
  it("excludes credential/config paths and reports the exclusions", async () => {
    const f = await fixture(); await fs.writeFile(path.join(f.source, "credentials.json"), "private", { mode: 0o600 });
    const result = await createSnapshot([{ key: "memory", path: f.source }], f.destination);
    expect(result.scan.files).toBe(1); expect(result.scan.excluded).toBe(1);
  });
});
