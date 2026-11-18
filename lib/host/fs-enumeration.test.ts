import { afterAll, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "mso-enumeration-"));
// Keep credential-root resolution inside the synthetic fixture, not the operator home.
vi.stubEnv("HOME", root);
vi.stubEnv("OS_FS_READ_ROOTS", root);
const { listDir, searchFs } = await import("./fs-enumeration");
afterAll(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

// A caller can be rejected by the 5s deadline while its slot is still draining, so a
// post-failure assertion can observe a 429 that is about admission, not about its own
// subject. Poll until admission is released, then assert the behaviour under test.
const settled = async (): Promise<number | "ok"> => {
  try { await listDir(root); return "ok"; } catch (error) { return (error as { status?: number }).status ?? -1; }
};
const awaitAdmission = () => expect.poll(settled, { timeout: 10_000, interval: 100 }).not.toBe(429);

// 10,001 fixture files plus concurrent enumeration: ~15s of real filesystem work that
// cannot fit the 15s global testTimeout when the gate runs suites in parallel. Raised
// for this test only, so a genuinely hung test still fails fast elsewhere.
it("bounds oversized listings, sparse searches and concurrent work, releasing admission after failure", async () => {
  const large = path.join(root, "large"); await mkdir(large);
  for (let n = 0; n < 10_001; n++) await writeFile(path.join(large, `entry-${n}`), "");
  await expect(listDir(large)).rejects.toMatchObject({ status: 413 });
  await expect(searchFs("no-match", { root: large })).rejects.toMatchObject({ status: 413 });
  const first = listDir(large), second = listDir(large);
  await expect(listDir(large)).rejects.toMatchObject({ status: 429 });
  await Promise.allSettled([first, second]);
  // After a budget failure, admission is released again.
  await awaitAdmission();
  await expect(listDir(root)).resolves.toMatchObject({ entries: [{ name: "large" }] });
  await expect(listDir(root, true, AbortSignal.abort())).rejects.toMatchObject({ status: 408 });
}, 60_000);

it("bounds the complete listing response including configured-root metadata", async () => {
  // A 429 here would be about leftover admission, not about the response size under test.
  await awaitAdmission();
  process.env.OS_FS_READ_ROOTS = [root, ...Array(12_000).fill("/")].join(path.delimiter);
  try { await expect(listDir(root)).rejects.toMatchObject({ status: 413 }); }
  finally { process.env.OS_FS_READ_ROOTS = root; }
});
