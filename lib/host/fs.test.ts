import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { copy, makeDir, move, remove, writeFile } from "./fs";

// Mirrors paths.test.ts setup. Layout:
//   base/read/             ← read root
//   base/read/write/       ← write root (narrower than read)
//   base/read/write/exists.txt
//   base/read/write/wlink  → symlink to base/outside/secret.txt (escapes write root)
//   base/outside/secret.txt (outside any root)
let base = "";
let readRoot = "";
let writeRoot = "";
let outside = "";

beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "mso-fs-")));
  readRoot = path.join(base, "read");
  writeRoot = path.join(readRoot, "write");
  outside = path.join(base, "outside");
  mkdirSync(writeRoot, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(writeRoot, "exists.txt"), "old");
  writeFileSync(path.join(outside, "secret.txt"), "nope");
  symlinkSync(path.join(outside, "secret.txt"), path.join(writeRoot, "wlink"));
});

afterAll(() => rmSync(base, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

function useRoots(read: string, write: string) {
  vi.stubEnv("OS_FS_READ_ROOTS", read);
  vi.stubEnv("OS_FS_WRITE_ROOTS", write);
}

describe("writeFile (atomic write inside WRITE roots)", () => {
  it("writes a new file inside the write root", async () => {
    useRoots(readRoot, writeRoot);
    const target = path.join(writeRoot, "fresh.txt");
    await writeFile(target, "hello");
    expect(readFileSync(target, "utf8")).toBe("hello");
    // tmp sibling must have been renamed (no leftover .tmp-* file)
    expect(existsSync(`${target}.tmp-${process.pid}`)).toBe(false);
  });

  it("overwrites an existing file via atomic rename (clobber-by-design)", async () => {
    useRoots(readRoot, writeRoot);
    const target = path.join(writeRoot, "exists.txt");
    await writeFile(target, "new content");
    expect(readFileSync(target, "utf8")).toBe("new content");
  });

  it("rejects a write OUTSIDE the write root with a bounds error", async () => {
    useRoots(readRoot, writeRoot);
    // Outside the write root entirely (parent is `base/outside`).
    await expect(writeFile(path.join(outside, "evil.txt"), "x")).rejects.toThrow(
      /outside writable roots/i,
    );
  });

  it("a writeFile via a symlink does NOT clobber the symlink target (atomic rename replaces the link itself)", async () => {
    // SURPRISE: writeFile uses safeWritePath(p, mustExist=false), which only
    // realpath-checks the PARENT — wlink's parent IS the write root, so the
    // bounds check passes. The implementation is still safe because the atomic
    // tmp+rename pair runs ENTIRELY inside the write root: fs.rename replaces
    // the symlink with a regular file rather than following it, so the secret
    // outside the root is left untouched. We pin that contract here.
    useRoots(readRoot, writeRoot);
    await writeFile(path.join(writeRoot, "wlink"), "pwn");
    expect(readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("nope");
    expect(readFileSync(path.join(writeRoot, "wlink"), "utf8")).toBe("pwn");
  });
});

describe("makeDir (recursive mkdir inside WRITE roots)", () => {
  it("creates missing parent directories recursively", async () => {
    useRoots(readRoot, writeRoot);
    const target = path.join(writeRoot, "mkdir-parent", "child", "grandchild");
    await makeDir(target);
    expect(existsSync(target)).toBe(true);
  });

  it("rejects a missing descendant below an existing symlink that escapes the write root", async () => {
    useRoots(readRoot, writeRoot);
    const outsideDir = path.join(outside, "mkdir-outside"); mkdirSync(outsideDir, { recursive: true });
    const link = path.join(writeRoot, "mkdir-link");
    try { symlinkSync(outsideDir, link, "dir"); } catch { /* stable across retries */ }
    await expect(makeDir(path.join(link, "new", "child"))).rejects.toThrow(/outside writable roots/i);
    expect(existsSync(path.join(outsideDir, "new"))).toBe(false);
  });
});

describe("move (rename)", () => {
  it("renames a file inside the write root", async () => {
    useRoots(readRoot, writeRoot);
    const from = path.join(writeRoot, "mv-src.txt");
    const to = path.join(writeRoot, "mv-dst.txt");
    writeFileSync(from, "payload");
    await move(from, to);
    expect(existsSync(from)).toBe(false);
    expect(readFileSync(to, "utf8")).toBe("payload");
  });

  it("CLOBBERS an existing destination file (current fs.rename semantics)", async () => {
    // Audit-claimed behavior: move/rename uses fs.rename with no pre-check, so
    // moving over an existing file silently overwrites. Pin the contract.
    useRoots(readRoot, writeRoot);
    const from = path.join(writeRoot, "mv2-src.txt");
    const to = path.join(writeRoot, "mv2-dst.txt");
    writeFileSync(from, "winner");
    writeFileSync(to, "loser");
    await move(from, to);
    expect(existsSync(from)).toBe(false);
    expect(readFileSync(to, "utf8")).toBe("winner");
  });

  it("rejects moving FROM outside the write root", async () => {
    useRoots(readRoot, writeRoot);
    await expect(
      move(path.join(outside, "secret.txt"), path.join(writeRoot, "x.txt")),
    ).rejects.toThrow(/outside writable roots/i);
  });
});

describe("remove", () => {
  it("removes a file inside the write root", async () => {
    useRoots(readRoot, writeRoot);
    const target = path.join(writeRoot, "to-remove.txt");
    writeFileSync(target, "");
    await remove(target);
    expect(existsSync(target)).toBe(false);
  });

  it("rejects a remove that uses ../ traversal to escape the write root", async () => {
    useRoots(readRoot, writeRoot);
    const sneaky = `${writeRoot}/../../outside/secret.txt`;
    await expect(remove(sneaky)).rejects.toThrow(/outside writable roots/i);
    // Original must survive.
    expect(existsSync(path.join(outside, "secret.txt"))).toBe(true);
  });

  it("refuses to remove a write root itself", async () => {
    useRoots(readRoot, writeRoot);
    await expect(remove(writeRoot)).rejects.toThrow(/root directory/i);
  });
});

describe("recursive credential mutation guard", () => {
  it("refuses copy, move, and delete when a nested loose credential exists", async () => {
    useRoots(readRoot, writeRoot);
    const source = path.join(writeRoot, "credential-tree");
    const nested = path.join(source, "nested");
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, "deploy.pem"), "synthetic");

    await expect(copy(source, path.join(writeRoot, "copied-tree"))).rejects.toThrow(/credential/i);
    await expect(move(source, path.join(writeRoot, "moved-tree"))).rejects.toThrow(/credential/i);
    await expect(remove(source)).rejects.toThrow(/credential/i);
    expect(existsSync(path.join(nested, "deploy.pem"))).toBe(true);
    rmSync(source, { recursive: true, force: true });
  });
});
