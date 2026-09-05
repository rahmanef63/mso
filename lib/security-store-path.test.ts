import { constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pinSecurityStorePath } from "./security-store-path";
import { withSecurityStoreLock } from "./security-store-lock";

const roots: string[] = [];
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-pinned-store-")); roots.push(root); return root; }
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

describe("pinned owner security-store paths", () => {
  it("rejects traversal and non-canonical symlink ancestors before creating a target", async () => {
    const root = await fixture(), outside = await fixture();
    await fs.symlink(outside, path.join(root, "alias"));
    await expect(pinSecurityStorePath(path.join(root, "alias/new/store.json"))).rejects.toThrow();
    await expect(fs.stat(path.join(outside, "new"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(pinSecurityStorePath("../../etc/store.json")).rejects.toThrow(/absolute path/);
    await expect(pinSecurityStorePath("/etc/unauthorized-store.json")).rejects.toThrow(/outside configured/);
  });
  it("refuses shared writable store parents", async () => {
    const root = await fixture(); await fs.chmod(root, 0o777);
    await expect(pinSecurityStorePath(path.join(root, "store.json"))).rejects.toThrow(/not writable by others/);
  });
  it("keeps operations on the pinned inode after the pathname is replaced", async () => {
    const root = await fixture(), original = path.join(root, "original"), moved = path.join(root, "moved");
    await fs.mkdir(original, { mode: 0o700 });
    const pinned = await pinSecurityStorePath(path.join(original, "store.json"));
    try {
      await fs.rename(original, moved); await fs.mkdir(original, { mode: 0o700 });
      const handle = await fs.open(pinned.file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      try { await handle.writeFile("owned"); } finally { await handle.close(); }
      expect(await fs.readFile(path.join(moved, "store.json"), "utf8")).toBe("owned");
      await expect(fs.stat(path.join(original, "store.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await pinned.directory.close(); }
  });
  it("will not follow a malicious lock symlink or enter the transaction", async () => {
    const root = await fixture(), store = path.join(root, "store.json"), external = path.join(root, "untouched");
    await fs.writeFile(external, "private", { mode: 0o600 }); await fs.symlink(external, `${store}.lock`);
    let entered = false;
    await expect(withSecurityStoreLock(store, async () => { entered = true; }, { waitMs: 1, busyTimeoutMs: 15 })).rejects.toThrow(/busy/);
    expect(entered).toBe(false); expect(await fs.readFile(external, "utf8")).toBe("private");
    expect((await fs.lstat(`${store}.lock`)).isSymbolicLink()).toBe(true);
  });
});
