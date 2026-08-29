import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { assertNotRoot, assertUploadTarget, isUnderRoot, resolveReadable, safeWritePath } from "./paths";

// Real temp tree (realpath runs on every request, so files must exist):
//   base/read/            ← read root
//   base/read/inside.txt
//   base/read/sneaky      → symlink to base/outside/secret.txt
//   base/read/write/      ← write root (narrower than read)
//   base/read/write/wlink → symlink to base/outside/secret.txt
//   base/outside/secret.txt
let base = "", readRoot = "", writeRoot = "";
let readPrefixSibling = "", writePrefixSibling = "", outside = "";

beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "mso-paths-")));
  readRoot = path.join(base, "read");
  writeRoot = path.join(readRoot, "write");
  readPrefixSibling = `${readRoot}-sibling`;
  writePrefixSibling = `${writeRoot}-sibling`;
  outside = path.join(base, "outside");
  mkdirSync(writeRoot, { recursive: true });
  mkdirSync(readPrefixSibling, { recursive: true });
  mkdirSync(writePrefixSibling, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(readRoot, "inside.txt"), "ok");
  writeFileSync(path.join(writeRoot, "wfile.txt"), "ok");
  writeFileSync(path.join(readPrefixSibling, "lookalike.txt"), "nope");
  writeFileSync(path.join(writePrefixSibling, "lookalike.txt"), "nope");
  writeFileSync(path.join(outside, "secret.txt"), "nope");
  symlinkSync(path.join(outside, "secret.txt"), path.join(readRoot, "sneaky"));
  symlinkSync(path.join(outside, "secret.txt"), path.join(writeRoot, "wlink"));
  symlinkSync(outside, path.join(writeRoot, "wdirlink"), "dir");
});

afterAll(() => rmSync(base, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

function useRoots(read: string, write: string) {
  vi.stubEnv("OS_FS_READ_ROOTS", read);
  vi.stubEnv("OS_FS_WRITE_ROOTS", write);
}

describe("isUnderRoot", () => {
  it("accepts the root itself and children, rejects siblings and parents", () => {
    expect(isUnderRoot("/a/b", "/a/b")).toBe(true);
    expect(isUnderRoot("/a/b/c.txt", "/a/b")).toBe(true);
    expect(isUnderRoot("/a/bb", "/a/b")).toBe(false); // prefix-string trap
    expect(isUnderRoot("/a", "/a/b")).toBe(false);
    expect(isUnderRoot("/etc/passwd", "/home/x")).toBe(false);
  });
});

describe("resolveReadable bounds", () => {
  it("resolves a path inside the read root", async () => {
    useRoots(readRoot, writeRoot);
    await expect(resolveReadable(path.join(readRoot, "inside.txt"))).resolves.toBe(
      path.join(readRoot, "inside.txt"),
    );
  });

  it("rejects ../ traversal that escapes the read root", async () => {
    useRoots(readRoot, writeRoot);
    const sneaky = `${readRoot}/../outside/secret.txt`;
    await expect(resolveReadable(sneaky)).rejects.toThrow(/outside readable roots/i);
  });

  it("rejects a nonexistent outside path before probing it with realpath", async () => {
    useRoots(readRoot, writeRoot);
    await expect(resolveReadable(path.join(outside, "does-not-exist.txt")))
      .rejects.toThrow(/outside readable roots/i);
  });

  it("rejects a sibling whose name merely starts with the read-root string", async () => {
    useRoots(readRoot, writeRoot);
    await expect(resolveReadable(path.join(readPrefixSibling, "lookalike.txt")))
      .rejects.toThrow(/outside readable roots/i);
  });

  it("rejects a symlink inside the root that points outside it", async () => {
    useRoots(readRoot, writeRoot);
    await expect(resolveReadable(path.join(readRoot, "sneaky"))).rejects.toThrow(
      /outside readable roots/i,
    );
  });
});

describe("credential denylist (read root = / so only the denylist gates)", () => {
  const home = os.homedir();
  const sshDir = path.join(home, ".ssh");
  const storeDir = path.join(home, ".mso");
  const envLocal = path.join(process.cwd(), ".env.local");
  const envExample = path.join(process.cwd(), ".env.example");

  it.skipIf(!existsSync(sshDir))("blocks ~/.ssh even inside a legal root", async () => {
    useRoots("/", writeRoot);
    await expect(resolveReadable(sshDir)).rejects.toThrow(/credential|sensitive/i);
  });

  it.skipIf(!existsSync(storeDir))("blocks the ~/.mso config store", async () => {
    useRoots("/", writeRoot);
    await expect(resolveReadable(storeDir)).rejects.toThrow(/credential|sensitive/i);
  });

  it.skipIf(!existsSync(envLocal))("blocks the app's own .env.local", async () => {
    useRoots("/", writeRoot);
    await expect(resolveReadable(envLocal)).rejects.toThrow(/credential|sensitive/i);
  });

  it.skipIf(!existsSync(envExample))("still allows .env.example (no secrets)", async () => {
    useRoots("/", writeRoot);
    await expect(resolveReadable(envExample)).resolves.toBe(realpathSync(envExample));
  });
});

describe("assertUploadTarget (upload jail — same denylist + realpath bounds as writes)", () => {
  it("allows a normal file and a nested new path inside the dest", async () => {
    await expect(assertUploadTarget(path.join(writeRoot, "up.txt"), writeRoot)).resolves.toBeUndefined();
    await expect(assertUploadTarget(path.join(writeRoot, "sub/dir/up.txt"), writeRoot)).resolves.toBeUndefined();
  });

  it("rejects a lexical escape (..)", async () => {
    await expect(assertUploadTarget(path.join(writeRoot, "../escape.txt"), writeRoot)).rejects.toThrow(/escapes/i);
  });

  it("rejects a write through a symlinked intermediate dir pointing outside the dest", async () => {
    await expect(assertUploadTarget(path.join(writeRoot, "wdirlink", "x.txt"), writeRoot)).rejects.toThrow(/escapes|symlink/i);
  });
});

describe("safeWritePath bounds", () => {
  it("allows writing to an existing file inside the write root", async () => {
    useRoots(readRoot, writeRoot);
    await expect(safeWritePath(path.join(writeRoot, "wfile.txt"), true)).resolves.toBe(
      path.join(writeRoot, "wfile.txt"),
    );
  });

  it("allows a new file whose parent is inside the write root", async () => {
    useRoots(readRoot, writeRoot);
    await expect(safeWritePath(path.join(writeRoot, "new.txt"), false)).resolves.toBe(
      path.join(writeRoot, "new.txt"),
    );
  });

  it("rejects writes to a read-only area (inside read root, outside write root)", async () => {
    useRoots(readRoot, writeRoot);
    await expect(safeWritePath(path.join(readRoot, "inside.txt"), true)).rejects.toThrow(
      /outside writable roots/i,
    );
  });

  it("rejects a new file whose parent is outside the write root", async () => {
    useRoots(readRoot, writeRoot);
    await expect(safeWritePath(path.join(readRoot, "new.txt"), false)).rejects.toThrow(
      /outside writable roots/i,
    );
  });

  it("rejects existing and new paths under a write-root prefix lookalike", async () => {
    useRoots(readRoot, writeRoot);
    await expect(safeWritePath(path.join(writePrefixSibling, "lookalike.txt"), true))
      .rejects.toThrow(/outside writable roots/i);
    await expect(safeWritePath(path.join(writePrefixSibling, "new.txt"), false))
      .rejects.toThrow(/outside writable roots/i);
  });

  it("rejects a nonexistent outside parent before resolving filesystem metadata", async () => {
    useRoots(readRoot, writeRoot);
    await expect(safeWritePath(path.join(outside, "missing", "new.txt"), false))
      .rejects.toThrow(/outside writable roots/i);
  });

  it("rejects ../ traversal out of the write root", async () => {
    useRoots(readRoot, writeRoot);
    await expect(
      safeWritePath(`${writeRoot}/../../outside/secret.txt`, true),
    ).rejects.toThrow(/outside writable roots/i);
  });

  it("rejects writing through a symlink that escapes the write root", async () => {
    useRoots(readRoot, writeRoot);
    await expect(safeWritePath(path.join(writeRoot, "wlink"), true)).rejects.toThrow(
      /outside writable roots/i,
    );
  });

  it("collapses '/' to home, never the filesystem root", async () => {
    useRoots(readRoot, os.homedir());
    await expect(safeWritePath("/", true)).resolves.toBe(realpathSync(os.homedir()));
  });
});

// Adversarial fuzz cases against the read/write jail. Each input must be
// REJECTED — these are the shapes a malicious caller might try to smuggle
// through realpath + bounds checks. Documented gaps (if any) are noted inline.
describe("FS jail fuzz — adversarial inputs", () => {
  it("rejects ../ traversal that escapes via the home alias", async () => {
    useRoots(readRoot, writeRoot);
    // ~/../../etc/passwd ends up outside any read root on a normal box.
    await expect(resolveReadable("~/../../../../../etc/passwd")).rejects.toThrow(
      /outside readable roots|credential|sensitive/i,
    );
  });

  it("rejects a path containing a NUL byte (Node throws on the syscall)", async () => {
    useRoots(readRoot, writeRoot);
    // POSIX path APIs reject \0 — the jail inherits that for free, but pin it
    // so a refactor that pre-normalizes the input can't accidentally strip it.
    await expect(resolveReadable(`${readRoot}/safe\0/../../outside/secret.txt`)).rejects.toThrow();
  });

  it("rejects a write through a symlink whose target sits outside the write root", async () => {
    // wlink → outside/secret.txt was wired up in beforeAll().
    useRoots(readRoot, writeRoot);
    await expect(safeWritePath(path.join(writeRoot, "wlink"), true)).rejects.toThrow(
      /outside writable roots/i,
    );
  });

  it("treats URL-encoded ../ as a literal filename (NOT decoded)", async () => {
    useRoots(readRoot, writeRoot);
    // The FS API takes a literal path. `..%2f` is just a basename — realpath
    // resolves it inside the read root and the file simply does not exist.
    // Either rejects with ENOENT-style OR resolves inside the root; what it
    // MUST NOT do is escape. Assert the reject (ENOENT) for the unit case.
    await expect(resolveReadable(`${readRoot}/..%2fetc/passwd`)).rejects.toThrow();
  });

  it("rejects an extremely long path (>4096 bytes) at the OS layer", async () => {
    useRoots(readRoot, writeRoot);
    const giant = `${readRoot}/${"a".repeat(5000)}`;
    // ENAMETOOLONG from realpath — the bound check never even fires, which is
    // fine: rejection is rejection. Pinned so a future "soft" path resolver
    // doesn't silently truncate + then bypass the bounds check.
    await expect(resolveReadable(giant)).rejects.toThrow();
  });

  it("normalizes double-slashes inside a legal root (path.resolve collapses them)", async () => {
    useRoots(readRoot, writeRoot);
    // // is benign — POSIX collapses it. Pin the behavior so the bounds check
    // doesn't get fooled by a //-prefixed UNC-looking path on Linux.
    await expect(resolveReadable(`${readRoot}//inside.txt`)).resolves.toBe(
      path.join(readRoot, "inside.txt"),
    );
  });

  it("refuses to modify the write root itself even via assertNotRoot", async () => {
    useRoots(readRoot, writeRoot);
    await expect(assertNotRoot(writeRoot)).rejects.toThrow(/root directory/i);
  });

  it("rejects ../ traversal on writes that lands in a sibling outside the root", async () => {
    useRoots(readRoot, writeRoot);
    await expect(safeWritePath(`${writeRoot}/../inside.txt`, true)).rejects.toThrow(
      /outside writable roots/i,
    );
  });
});

describe("assertNotRoot", () => {
  it("refuses to modify a write root itself but allows its children", async () => {
    useRoots(readRoot, writeRoot);
    await expect(assertNotRoot(writeRoot)).rejects.toThrow(/root directory/i);
    await expect(assertNotRoot(path.join(writeRoot, "wfile.txt"))).resolves.toBeUndefined();
  });
});
