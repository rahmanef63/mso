import { afterAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { BOUNDED_READ, readBoundedRegularFile } from "./bounded-read";

// Every metadata read in project/skill discovery goes through this. The point is
// that the CAP is checked before any bytes are read: a 2 GiB package.json in an
// attacker-influenced checkout must cost one fstat, not 2 GiB of heap, and a
// read-scope projects_list must not be a memory-exhaustion primitive.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-bounded-"));
vi.stubEnv("OS_FS_READ_ROOTS", dir);
afterAll(async () => { vi.unstubAllEnvs(); await fs.rm(dir, { recursive: true, force: true }); });

describe("readBoundedRegularFile", () => {
  it("reads a regular file within the cap", async () => {
    const file = path.join(dir, "ok.json");
    await fs.writeFile(file, '{"name":"ok"}');
    await expect(readBoundedRegularFile(file, 1024)).resolves.toBe('{"name":"ok"}');
  });

  it("refuses a file larger than the cap WITHOUT reading it", async () => {
    const file = path.join(dir, "huge.json");
    await fs.writeFile(file, "x".repeat(5000));
    await expect(readBoundedRegularFile(file, 1024)).resolves.toBeNull();
    // The boundary itself is inclusive, so a file exactly at the cap still reads.
    await expect(readBoundedRegularFile(file, 5000)).resolves.toHaveLength(5000);
  });

  it("refuses a symlink at the final component — O_NOFOLLOW, not realpath-then-read", async () => {
    const target = path.join(dir, "target.json");
    await fs.writeFile(target, '{"name":"target"}');
    const link = path.join(dir, "link.json");
    await fs.symlink(target, link);
    await expect(readBoundedRegularFile(link, 1024)).resolves.toBeNull();
  });

  it("refuses a directory and a missing path", async () => {
    await expect(readBoundedRegularFile(dir, 1024)).resolves.toBeNull();
    await expect(readBoundedRegularFile(path.join(dir, "nope"), 1024)).resolves.toBeNull();
  });

  it("rejects outside roots and parent symlink escapes before opening", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "mso-bounded-outside-"));
    try {
      const file = path.join(outside, "secret");
      await fs.writeFile(file, "secret");
      await expect(readBoundedRegularFile(file, 1024)).resolves.toBeNull();
      await expect(readBoundedRegularFile(file, 1024, outside)).resolves.toBe("secret");
      await expect(readBoundedRegularFile(file, 1024, dir)).resolves.toBeNull();
      await expect(readBoundedRegularFile(path.join(dir, "..", path.basename(outside), "secret"), 1024)).resolves.toBeNull();
      await fs.symlink(outside, path.join(dir, "redirect"));
      await expect(readBoundedRegularFile(path.join(dir, "redirect", "secret"), 1024)).resolves.toBeNull();
    } finally { await fs.rm(outside, { recursive: true, force: true }); }
  });

  it("publishes a cap for every discovery read", () => {
    for (const key of ["packageJson", "skillMd", "gitHead", "gitRef", "packedRefs"] as const) {
      expect(BOUNDED_READ[key], key).toBeGreaterThan(0);
    }
  });
});
