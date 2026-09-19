import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

let root = "";
let snapshot = "";

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-convex-snapshot-test-"));
  snapshot = path.join(root, "source.zip");
  process.env.OS_FS_READ_ROOTS = root;
  await fs.writeFile(
    snapshot,
    Buffer.from([
      0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0,
    ]),
    { mode: 0o600 },
  );
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.OS_FS_READ_ROOTS;
  await fs.rm(root, { recursive: true, force: true });
  vi.resetModules();
});

it("stages the checked snapshot from one open descriptor into a private immutable input", async () => {
  const original = await fs.readFile(snapshot);
  const { convexSnapshotContext } = await import("./convex-cloud-cli-runner");
  const context = await convexSnapshotContext(snapshot);
  expect(context.stagedSnapshot).not.toBe(snapshot);
  expect(path.dirname(context.stagedSnapshot)).toMatch(
    /mso-convex-snapshot-[^/\\]+$/,
  );
  expect((await fs.stat(path.dirname(context.stagedSnapshot))).mode & 0o777).toBe(0o700);
  expect((await fs.stat(context.stagedSnapshot)).mode & 0o777).toBe(0o600);
  await fs.writeFile(snapshot, "changed after validation", { mode: 0o600 });
  expect(await fs.readFile(context.stagedSnapshot)).toEqual(original);
  expect(context.sha256).toMatch(/^[a-f0-9]{64}$/);
  await context.cleanup();
  await expect(fs.stat(context.stagedSnapshot)).rejects.toMatchObject({ code: "ENOENT" });
});
