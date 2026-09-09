import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCwd, runCommand } from "./exec";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-cwd-"));
  vi.stubEnv("OS_FS_WRITE_ROOTS", dir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
});
describe("explicit command targets", () => {
  it("defaults only omitted cwd and returns the actual execution directory", async () => {
    expect(await resolveCwd()).toBe(os.homedir());
    expect(await runCommand("pwd", dir)).toMatchObject({ code: 0, cwd: await fs.realpath(dir) });
  });
  it("rejects a missing directory before running a command", async () => {
    await expect(runCommand("exit 0", path.join(dir, "missing"))).rejects.toThrow("does not exist");
  });
  it("rejects empty paths, files and explicit home outside writable roots", async () => {
    await fs.writeFile(path.join(dir, "file"), "fixture");
    await expect(resolveCwd("")).rejects.toThrow("empty");
    await expect(resolveCwd(path.join(dir, "file"))).rejects.toThrow("not a directory");
    await expect(resolveCwd("~")).rejects.toThrow("outside writable roots");
  });
  it("resolves symlinks before checking roots", async () => {
    await fs.symlink(os.homedir(), path.join(dir, "escape"));
    await expect(resolveCwd(path.join(dir, "escape"))).rejects.toThrow("outside writable roots");
    await fs.mkdir(path.join(dir, "inside"));
    await fs.symlink(path.join(dir, "inside"), path.join(dir, "alias"));
    expect(await resolveCwd(path.join(dir, "alias"))).toBe(path.join(dir, "inside"));
  });
});
