import { afterAll, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "mso-enumeration-"));
process.env.OS_FS_READ_ROOTS = root;
const { listDir, searchFs } = await import("./fs-enumeration");
afterAll(async () => { delete process.env.OS_FS_READ_ROOTS; await rm(root, { recursive: true, force: true }); });

it("bounds oversized listings, sparse searches and concurrent work, releasing admission after failure", async () => {
  const large = path.join(root, "large"); await mkdir(large);
  for (let n = 0; n < 10_001; n++) await writeFile(path.join(large, `entry-${n}`), "");
  await expect(listDir(large)).rejects.toMatchObject({ status: 413 });
  await expect(searchFs("no-match", { root: large })).rejects.toMatchObject({ status: 413 });
  const first = listDir(large), second = listDir(large);
  await expect(listDir(large)).rejects.toMatchObject({ status: 429 });
  await Promise.allSettled([first, second]);
  await expect(listDir(root)).resolves.toMatchObject({ entries: [{ name: "large" }] });
  await expect(listDir(root, true, AbortSignal.abort())).rejects.toMatchObject({ status: 408 });
}, 15_000);

it("bounds the complete listing response including configured-root metadata", async () => {
  process.env.OS_FS_READ_ROOTS = [root, ...Array(12_000).fill("/")].join(path.delimiter);
  try { await expect(listDir(root)).rejects.toMatchObject({ status: 413 }); }
  finally { process.env.OS_FS_READ_ROOTS = root; }
});
