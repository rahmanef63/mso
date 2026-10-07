import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManagedAppDefinition } from "./types";
import { createBackup, listBackups } from "./backups";

const roots: string[] = [];
function definition(root: string): ManagedAppDefinition {
  return { id: "openclaw", name: "fixture", stateDirName: ".state", homeDir: path.join(root, "state") } as ManagedAppDefinition;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe("managed-app backup quotas", () => {
  it("rate-limits manual snapshots", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-backup-quota-")); roots.push(root);
    vi.spyOn(os, "homedir").mockReturnValue(root);
    await fs.mkdir(path.join(root, "state"), { recursive: true });
    await fs.writeFile(path.join(root, "state", "config.json"), "{}");
    await createBackup(definition(root), "manual");
    await expect(createBackup(definition(root), "manual")).rejects.toThrow(/one per minute/);
  });

  it("rejects a state tree larger than the per-backup ceiling before copying", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-backup-large-")); roots.push(root);
    vi.spyOn(os, "homedir").mockReturnValue(root);
    await fs.mkdir(path.join(root, "state"), { recursive: true });
    const huge = path.join(root, "state", "huge.bin");
    const handle = await fs.open(huge, "w");
    try { await handle.truncate(513 * 1024 * 1024); } finally { await handle.close(); }
    await expect(createBackup(definition(root), "pre-update")).rejects.toThrow(/512 MiB state limit/);
    expect(await listBackups("openclaw")).toEqual([]);
  });
});
