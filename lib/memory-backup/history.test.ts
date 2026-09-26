import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSnapshot, verifySnapshot } from "./service";
import { listSnapshots } from "./history";
import { readManifest } from "./manifest";
import { readVerification } from "./verification-receipt";
const roots: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-history-test-")); roots.push(root);
  const source = path.join(root, "source"), backups = path.join(root, "backups");
  await fs.mkdir(source, { mode: 0o700 });
  await fs.writeFile(path.join(source, "note.md"), "Synthetic backup evidence", { mode: 0o600 });
  const make = (partial = false) => createSnapshot([{ key: "memory", path: source }], backups, partial);
  return { root, source, backups, make };
}
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
describe("bounded server backup history", () => {
  it("reports an absent history without creating it", async () => {
    const f = await fixture();
    expect(await listSnapshots(f.backups)).toMatchObject({ items: [], nextOffset: null });
    await expect(fs.stat(f.backups)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("continues directory pages without duplication or returning source contents", async () => {
    const f = await fixture(), saved = [await f.make(), await f.make(), await f.make()];
    const ids: string[] = []; let offset = 0, revision: string | undefined;
    for (let page = 0; page < 5; page++) {
      const result = await listSnapshots(f.backups, { offset, revision, limit: 1 });
      ids.push(...result.items.map(item => item.id));
      expect(JSON.stringify(result)).not.toContain("Synthetic backup evidence");
      if (result.nextOffset === null) break;
      offset = result.nextOffset; revision = result.revision;
    }
    expect(ids.sort()).toEqual(saved.map(s => s.id).sort()); expect(new Set(ids).size).toBe(3);
  });
  it("refuses stale cursors after the snapshot root changes", async () => {
    const f = await fixture(); await f.make(); await f.make();
    const first = await listSnapshots(f.backups, { limit: 1 });
    await f.make();
    await expect(listSnapshots(f.backups, { offset: first.nextOffset!, revision: first.revision })).rejects.toThrow("changed");
  });
  it.each([{ offset: -1 }, { offset: 1 }, { offset: 32769 }, { limit: 0 }, { limit: 21 }])("rejects invalid cursor %j", async options => {
    const f = await fixture(); await expect(listSnapshots(f.backups, options)).rejects.toThrow("cursor");
  });
  it("reports corrupt metadata and symlink entries as unreadable, not empty", async () => {
    const f = await fixture(), saved = await f.make();
    const manifestPath = path.join(saved.directory, "manifest.json");
    const m = JSON.parse(await fs.readFile(manifestPath, "utf8")); m.scan.files++;
    await fs.writeFile(manifestPath, JSON.stringify(m));
    const alias = "22222222-2222-4222-8222-222222222222";
    await fs.symlink(saved.directory, path.join(f.backups, alias));
    const history = await listSnapshots(f.backups);
    expect(history.items).toHaveLength(2);
    expect(history.items.every(item => item.status === "unreadable")).toBe(true);
  });
  it("distinguishes partial coverage from recorded integrity and preserves sources", async () => {
    const f = await fixture(), saved = await f.make(true);
    const before = await fs.readFile(path.join(f.source, "note.md"));
    const initial = await listSnapshots(f.backups);
    expect(initial.items[0]).toMatchObject({ status: "readable", integrity: "not-recorded", snapshot: { state: "partial" } });
    const verified = await verifySnapshot(f.backups, saved.id, saved.manifestSha256);
    expect(verified).toMatchObject({ complete: false, integrity: true, sourceWritesPerformed: 0 });
    const after = await listSnapshots(f.backups);
    expect(after.items[0]).toMatchObject({ status: "readable", integrity: "verified-at-recorded-time", snapshot: { state: "partial" } });
    expect(await fs.readFile(path.join(f.source, "note.md"))).toEqual(before);
  });
  it("retains the first immutable receipt while later restores use new directories", async () => {
    const f = await fixture(), saved = await f.make();
    const first = await verifySnapshot(f.backups, saved.id, saved.manifestSha256);
    const receipt = path.join(saved.directory, `verification-${saved.manifestSha256}.json`);
    const before = await fs.readFile(receipt);
    const second = await verifySnapshot(f.backups, saved.id, saved.manifestSha256);
    expect(second.restoreDirectory).not.toBe(first.restoreDirectory);
    expect(await fs.readFile(receipt)).toEqual(before);
  });
  it("does not turn malformed or manifest-mismatched receipts into an integrity pass", async () => {
    const f = await fixture(), saved = await f.make();
    const receipt = path.join(saved.directory, `verification-${saved.manifestSha256}.json`);
    await fs.writeFile(receipt, "{}", { mode: 0o600 });
    const { manifest } = await readManifest(f.backups, saved.id);
    expect(await readVerification(saved.directory, saved.manifestSha256, manifest)).toEqual({ integrity: "receipt-invalid" });
    await expect(verifySnapshot(f.backups, saved.id, saved.manifestSha256)).rejects.toThrow("existing verification receipt");
    expect((await listSnapshots(f.backups)).items[0]).toMatchObject({ status: "readable", integrity: "receipt-invalid" });
  });
});
