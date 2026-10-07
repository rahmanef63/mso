import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { withManagedAppOperationLease } = await import("./lock");
let home: string;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "mapp-lease-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(home, { recursive: true, force: true }); });

describe("cross-process managed-app operation lease", () => {
  it("refuses a second contender while the durable lease is held", async () => {
    let entered!: () => void, release!: () => void;
    const inside = new Promise<void>((resolve) => { entered = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const first = withManagedAppOperationLease("hermes", async () => { entered(); await hold; });
    await inside;
    await expect(withManagedAppOperationLease("hermes", async () => undefined)).rejects.toThrow("another operation is already running");
    release();
    await first;
    await expect(withManagedAppOperationLease("hermes", async () => "ok")).resolves.toBe("ok");
  });
});
