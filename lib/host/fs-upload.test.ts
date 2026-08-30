import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The upload writer had no test at all. It is a write boundary reachable from
// /api/v1/fs/upload, so the two things pinned here are the two that matter:
// a part must not escape the destination dir, and the size cap must actually stop
// bytes from landing on disk.
let dir: string;

async function load() {
  vi.resetModules();
  vi.stubEnv("OS_FS_WRITE_ROOTS", dir);
  vi.stubEnv("OS_FS_READ_ROOTS", dir);
  return import("./fs-upload");
}

// A body that yields `n` bytes in 1 MiB chunks without allocating them all at once.
async function* bytes(n: number): AsyncIterable<Uint8Array> {
  const CHUNK = 1024 * 1024;
  let sent = 0;
  while (sent < n) {
    const size = Math.min(CHUNK, n - sent);
    yield new Uint8Array(size);
    sent += size;
  }
}

async function* text(s: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(s);
}

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mso-upload-")));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("streamFileInto — the upload write boundary", () => {
  it("writes a normal file, including into a nested folder", async () => {
    const { resolveUploadDest, streamFileInto } = await load();
    const destReal = await resolveUploadDest(dir);

    expect(await streamFileInto(destReal, "imgs/a.txt", text("hello"))).toBe("ok");
    expect(await fs.readFile(path.join(dir, "imgs", "a.txt"), "utf8")).toBe("hello");
  });

  it.each([
    ["../escape.txt", "parent traversal"],
    ["../../etc/cron.d/pwn", "deep traversal"],
    ["a/../../../escape.txt", "traversal in the middle"],
    ["/etc/cron.d/pwn", "absolute path"],
    ["./././", "no usable segment"],
    ["", "empty"],
  ])("refuses %s (%s) and writes nothing outside dest", async (relPath) => {
    const { resolveUploadDest, streamFileInto } = await load();
    const destReal = await resolveUploadDest(dir);

    const res = await streamFileInto(destReal, relPath, text("pwned"));
    expect(res).toBe("bad-path");
    const escaped = path.resolve(dir, "..", "escape.txt");
    await expect(fs.access(escaped)).rejects.toThrow();
    await expect(fs.access("/etc/cron.d/pwn")).rejects.toThrow();
  });

  it("stops at the 100 MiB cap and leaves no file or .tmp behind", async () => {
    const { resolveUploadDest, streamFileInto } = await load();
    const destReal = await resolveUploadDest(dir);

    expect(await streamFileInto(destReal, "big.bin", bytes(101 * 1024 * 1024))).toBe("too-large");
    await expect(fs.access(path.join(dir, "big.bin"))).rejects.toThrow();
    expect((await fs.readdir(dir)).filter((f) => f.includes("mso-upload") || f.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects a destination outside the WRITE roots", async () => {
    const { resolveUploadDest } = await load();
    await expect(resolveUploadDest("/etc")).rejects.toThrow();
  });

  it("rejects a destination that is a file, not a directory", async () => {
    const file = path.join(dir, "notadir.txt");
    await fs.writeFile(file, "x");
    const { resolveUploadDest } = await load();
    await expect(resolveUploadDest(file)).rejects.toThrow(/not a directory/i);
  });
});
