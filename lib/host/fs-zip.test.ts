import path from "path";
import os from "os";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import type { Readable } from "stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appSecretExcludes, assertSafeName, zipStream } from "./fs-zip";

describe("assertSafeName", () => {
  it("accepts a plain basename", () => {
    expect(() => assertSafeName("report.pdf")).not.toThrow();
    expect(() => assertSafeName(".hidden")).not.toThrow();
    expect(() => assertSafeName("a folder")).not.toThrow();
  });

  it("rejects traversal, separators and NUL", () => {
    for (const bad of ["", ".", "..", "../etc/passwd", "a/b", "a\\b", "x\0y", "/abs"])
      expect(() => assertSafeName(bad)).toThrow();
  });
});

describe("appSecretExcludes", () => {
  // appDir() = realpath(cwd) = the repo root during the test run.
  const appDir = realpathSync(process.cwd());
  const appName = path.basename(appDir);

  it("strips the app's .env* when a PARENT is the archive base", () => {
    // The exploit: zip ~/projects (parent) with mso nested inside.
    expect(appSecretExcludes(path.dirname(appDir))).toEqual([
      `${appName}/.env`,
      `${appName}/.env.*`,
    ]);
  });

  it("no-ops when base is the app dir itself or unrelated to it", () => {
    expect(appSecretExcludes(appDir)).toEqual([]);
    expect(appSecretExcludes("/some/unrelated/dir")).toEqual([]);
  });
});

// Real `zip` runs here. These three are the behaviours a piped/rewritten zip path
// silently regressed before: a partial archive being thrown away, an exclude that
// misses the archive root, and the tmpdir surviving the request.
describe("zipStream against the real zip binary", () => {
  let base = "";
  const read = async (s: Readable): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    for await (const c of s) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  };
  // Entry names, straight out of the central directory — no unzip shell-out.
  const entries = (zip: Buffer): string[] => {
    const out: string[] = [];
    for (let i = 0; i + 46 <= zip.length; i++) {
      if (zip.readUInt32LE(i) !== 0x02014b50) continue;
      const n = zip.readUInt16LE(i + 28);
      out.push(zip.subarray(i + 46, i + 46 + n).toString("utf8"));
    }
    return out;
  };

  beforeAll(() => {
    base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "mso-zip-")));
    process.env.OS_FS_READ_ROOTS = base;
    mkdirSync(path.join(base, "node_modules"), { recursive: true });
    mkdirSync(path.join(base, "proj", "node_modules"), { recursive: true });
    writeFileSync(path.join(base, "node_modules", "root-dep.txt"), "root\n");
    writeFileSync(path.join(base, "proj", "node_modules", "nested-dep.txt"), "nested\n");
    writeFileSync(path.join(base, "proj", "src.txt"), "keep\n");
    writeFileSync(path.join(base, "keep.txt"), "keep\n");
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it("excludes a heavy dir at the archive ROOT, not just below it", async () => {
    const names = entries(await read(await zipStream(base, ["node_modules", "proj", "keep.txt"], ["node_modules"])));
    // `*/name/*` alone cannot match at the root — this is the case that leaked.
    expect(names.some((n) => n.startsWith("node_modules/"))).toBe(false);
    expect(names.some((n) => n.includes("proj/node_modules/"))).toBe(false);
    expect(names).toContain("keep.txt");
    expect(names).toContain("proj/src.txt");
  });

  it("force-strips nested loose private keys from recursive archives", async () => {
    const dir = path.join(base, "secrets-fixture");
    mkdirSync(path.join(dir, "nested"), { recursive: true });
    writeFileSync(path.join(dir, "nested", "id_rsa"), "dummy-private-key\n");
    writeFileSync(path.join(dir, "nested", "deploy.pem"), "dummy-pem\n");
    writeFileSync(path.join(dir, "nested", "id_rsa.pub"), "public-key\n");
    writeFileSync(path.join(dir, "nested", "readme.txt"), "keep\n");
    const names = entries(await read(await zipStream(base, ["secrets-fixture"])));
    expect(names).not.toContain("secrets-fixture/nested/id_rsa");
    expect(names).not.toContain("secrets-fixture/nested/deploy.pem");
    expect(names).toContain("secrets-fixture/nested/id_rsa.pub");
    expect(names).toContain("secrets-fixture/nested/readme.txt");
  });

  it("returns the archive when one file is unreadable (zip exit 18)", async () => {
    const dir = path.join(base, "partial");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "readable.txt"), "fine\n");
    writeFileSync(path.join(dir, "locked.txt"), "nope\n");
    chmodSync(path.join(dir, "locked.txt"), 0o000);
    try {
      const names = entries(await read(await zipStream(dir, ["readable.txt", "locked.txt"])));
      expect(names).toContain("readable.txt"); // the whole point: not an empty error
      expect(names).not.toContain("locked.txt");
    } finally {
      chmodSync(path.join(dir, "locked.txt"), 0o644);
    }
  });

  it("says so plainly when everything was excluded (zip exit 12)", async () => {
    await expect(zipStream(base, ["proj"], ["proj"])).rejects.toThrow(/nothing to archive/i);
  });

  // The unlink happens before zipStream resolves, so this holds even for a stream
  // nobody ever reads — the abandoned-request case that used to strand a tmpdir.
  it("leaves no temp directory behind, drained or not", async () => {
    const stale = () => (readdirSync(os.tmpdir())).filter((n) => n.startsWith("os-zip-")).length;
    const before = stale();
    const abandoned = await zipStream(base, ["keep.txt"]);
    expect(stale()).toBe(before);
    const drained = await read(await zipStream(base, ["keep.txt"]));
    expect(entries(drained)).toContain("keep.txt"); // unlinked bytes still readable
    expect(stale()).toBe(before);
    abandoned.destroy();
  });
});
