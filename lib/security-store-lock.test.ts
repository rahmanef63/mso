import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withSecurityStoreLock } from "./security-store-lock";

const roots: string[] = [];
async function tempStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-lock-"));
  roots.push(root);
  return path.join(root, "store.json");
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("security-store stale recovery", () => {
  it("serializes simultaneous recoverers before either callback enters", async () => {
    const store = await tempStore();
    const lock = `${store}.lock`;
    await fs.writeFile(lock, "999999999:abandoned", { mode: 0o600 });
    let active = 0;
    let maxActive = 0;
    const entered: number[] = [];
    await Promise.all(Array.from({ length: 24 }, (_, index) =>
      withSecurityStoreLock(store, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        entered.push(index);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
      // Coverage runs instrument hundreds of files in parallel and can delay fsync-heavy
      // contenders beyond 2s without changing mutual exclusion. Keep the test budget
      // below Vitest's outer timeout while avoiding a scheduler-dependent false failure.
      }, { waitMs: 1, busyTimeoutMs: 4_000, staleMs: 1 }),
    ));
    expect(maxActive).toBe(1);
    expect(entered).toHaveLength(24);
    await expect(fs.stat(lock)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never deletes a live lock merely because it is old", async () => {
    const store = await tempStore();
    const lock = `${store}.lock`;
    await fs.writeFile(lock, `${process.pid}:live`, { mode: 0o600 });
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(lock, old, old);
    await expect(withSecurityStoreLock(store, async () => undefined, {
      waitMs: 2, busyTimeoutMs: 25, staleMs: 1,
    })).rejects.toThrow(/security store is busy/);
    await expect(fs.readFile(lock, "utf8")).resolves.toBe(`${process.pid}:live`);
  });

  it("fails closed behind an existing recovery guard", async () => {
    const store = await tempStore();
    await fs.writeFile(`${store}.lock`, "999999999:abandoned", { mode: 0o600 });
    await fs.writeFile(`${store}.lock.recovery`, `${process.pid}:guard`, { mode: 0o600 });
    await expect(withSecurityStoreLock(store, async () => undefined, {
      waitMs: 2, busyTimeoutMs: 25, staleMs: 1,
    })).rejects.toThrow(/security store is busy/);
    await expect(fs.readFile(`${store}.lock`, "utf8")).resolves.toContain("abandoned");
  });
});
