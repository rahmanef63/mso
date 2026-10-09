import { promises as fs, renameSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withIsolatedFilesystem, isolatedCwd } from "./fs-isolation";
import { writeFile, makeDir, remove, copy, move, readFile } from "./fs";
import { readBoundedBytes } from "./fs-descriptors";
import { uploadInto } from "./fs-upload";

let base: string, root: string, outside: string;
beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mso-isolation-")));
  root = path.join(base, "worktree"); outside = path.join(base, "outside");
  await fs.mkdir(root); await fs.mkdir(outside); await fs.writeFile(path.join(outside, "data"), "unchanged");
  await fs.symlink(outside, path.join(root, "escape"));
  vi.stubEnv("OS_FS_READ_ROOTS", base); vi.stubEnv("OS_FS_WRITE_ROOTS", base);
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await fs.rm(base, { recursive: true, force: true }); });
it.each(["write", "mkdir", "delete", "copy", "move", "upload", "exec"])("rejects an inside-worktree symlink for %s despite broad host roots", async operation => {
  const target = path.join(root, "escape", "data");
  await expect(withIsolatedFilesystem(root, async () => {
    if (operation === "write") return writeFile(target, "changed");
    if (operation === "mkdir") return makeDir(path.join(root, "escape", "new"));
    if (operation === "delete") return remove(target);
    if (operation === "copy") return copy(target, path.join(root, "escape", "new"));
    if (operation === "move") return move(target, path.join(root, "escape", "new"));
    if (operation === "upload") return uploadInto(path.join(root, "escape"), [{ relPath: "data", data: Buffer.from("changed") }]);
    return isolatedCwd(outside);
  })).rejects.toThrow(/isolated|ENOTDIR/);
  expect(await fs.readFile(path.join(outside, "data"), "utf8")).toBe("unchanged");
});
it("rejects an ancestor exchange into another globally writable project", async () => {
  const nested = path.join(root, "nested"); await fs.mkdir(nested);
  const open = fs.open.bind(fs); let swapped = false;
  vi.spyOn(fs, "open").mockImplementation((...args: Parameters<typeof fs.open>) => {
    if (!swapped && String(args[0]) === nested) { swapped = true; renameSync(nested, nested + "-held"); symlinkSync(outside, nested); }
    return open(...args);
  });
  await expect(withIsolatedFilesystem(root, () => writeFile(path.join(nested, "data"), "changed"))).rejects.toThrow(/isolated|ENOTDIR/);
  expect(swapped).toBe(true); expect(await fs.readFile(path.join(outside, "data"), "utf8")).toBe("unchanged");
});
it("executes in a pinned legitimate directory", async () => {
  await withIsolatedFilesystem(root, async () => {
    const cwd = await isolatedCwd(root);
    expect((await promisify(execFile)(process.execPath, ["-e", "process.stdout.write(process.cwd())"], { cwd })).stdout).toBe(root);
    await writeFile(path.join(root, "safe"), "ok");
  });
  expect(await fs.readFile(path.join(root, "safe"), "utf8")).toBe("ok");
});
it("rejects virtual filesystem bytes even when aliased beneath an ordinary root", async () => {
  vi.spyOn(fs, "statfs").mockResolvedValue({ type: 0x9fa0 } as never);
  await expect(readFile(path.join(outside, "data"))).rejects.toThrow(/virtual/i);
});
it("bounds bytes actually read rather than trusting prior metadata", async () => {
  const file = path.join(root, "growing"); await fs.writeFile(file, "a");
  const handle = await fs.open(file, "r+");
  try {
    expect((await handle.stat()).size).toBe(1); await handle.write("bcdef", 1, "utf8");
    await expect(readBoundedBytes(handle, 4)).rejects.toThrow(/large|limit/);
  } finally { await handle.close(); }
});
