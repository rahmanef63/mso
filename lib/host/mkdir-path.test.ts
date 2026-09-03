import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { makeDir } from "./fs";
import { safeMkdirPath } from "./paths";

let base = "";
let writeRoot = "";
let outside = "";

beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "mso-mkdir-")));
  writeRoot = path.join(base, "write");
  outside = path.join(base, "outside");
  mkdirSync(writeRoot, { recursive: true });
  mkdirSync(outside, { recursive: true });
});
afterAll(() => rmSync(base, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

function useWriteRoot(root = writeRoot) {
  vi.stubEnv("OS_FS_READ_ROOTS", root);
  vi.stubEnv("OS_FS_WRITE_ROOTS", root);
}

describe("recursive mkdir containment", () => {
  it("creates all missing parents inside a real write root", async () => {
    useWriteRoot();
    const target = path.join(writeRoot, "a", "b", "c");
    await expect(safeMkdirPath(target)).resolves.toBe(target);
    await makeDir(target);
    expect(existsSync(target)).toBe(true);
  });

  it("rejects a missing descendant below an existing symlink escape", async () => {
    useWriteRoot();
    const target = path.join(outside, "target");
    mkdirSync(target, { recursive: true });
    const link = path.join(writeRoot, "link");
    symlinkSync(target, link, "dir");
    await expect(makeDir(path.join(link, "new", "child"))).rejects.toThrow(/outside writable roots/i);
    expect(existsSync(path.join(target, "new"))).toBe(false);
  });

  it("keeps the owner .mso state tree blocked", async () => {
    useWriteRoot(os.homedir());
    await expect(safeMkdirPath(path.join(os.homedir(), ".mso", "smoke-tests", "x")))
      .rejects.toThrow(/credential|sensitive/i);
  });
});
