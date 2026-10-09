import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManagedAppDefinition } from "./types";
import { createBackup, listBackups } from "./backups";
vi.mock("server-only", () => ({}));

const roots: string[] = [];
function definition(root: string): ManagedAppDefinition {
  return { id: "openclaw", name: "fixture", stateDirName: ".state", homeDir: path.join(root, "state") } as ManagedAppDefinition;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe("managed-app backup quotas", () => {
  it("removes a snapshot if an app restarts while copying", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-backup-restart-")); roots.push(root);
    vi.spyOn(os, "homedir").mockReturnValue(root);
    await fs.mkdir(path.join(root, "state")); await fs.writeFile(path.join(root, "state", "config.json"), "{}");
    const guard = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValue(new Error("gateway restarted"));
    await expect(createBackup(definition(root), "pre-update", guard)).rejects.toThrow(/restarted/);
    expect(await listBackups("openclaw")).toEqual([]);
  });
  it("rejects growth after preflight and removes the incomplete snapshot", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-backup-growth-")); roots.push(root);
    vi.spyOn(os, "homedir").mockReturnValue(root);
    await fs.mkdir(path.join(root, "state"));
    await fs.writeFile(path.join(root, "state", "config.json"), "{}");
    const copy = fs.cp;
    vi.spyOn(fs, "cp").mockImplementationOnce(async (source, target, options) => {
      const huge = await fs.open(path.join(root, "state", "huge.bin"), "w");
      try { await huge.truncate(513 * 1024 * 1024); } finally { await huge.close(); }
      return copy(source, target, options);
    });
    await expect(createBackup(definition(root), "pre-update", async () => {})).rejects.toThrow(/backup changed/);
    expect(await listBackups("openclaw")).toEqual([]);
  });
  it("rate-limits manual snapshots", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-backup-quota-")); roots.push(root);
    vi.spyOn(os, "homedir").mockReturnValue(root);
    await fs.mkdir(path.join(root, "state"), { recursive: true });
    await fs.writeFile(path.join(root, "state", "config.json"), "{}");
    await createBackup(definition(root), "manual", async () => {});
    await expect(createBackup(definition(root), "manual", async () => {})).rejects.toThrow(/one per minute/);
  });

  it("rejects a state tree larger than the per-backup ceiling before copying", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-backup-large-")); roots.push(root);
    vi.spyOn(os, "homedir").mockReturnValue(root);
    await fs.mkdir(path.join(root, "state"), { recursive: true });
    const huge = path.join(root, "state", "huge.bin");
    const handle = await fs.open(huge, "w");
    try { await handle.truncate(513 * 1024 * 1024); } finally { await handle.close(); }
    await expect(createBackup(definition(root), "pre-update", async () => {})).rejects.toThrow(/512 MiB state limit/);
    expect(await listBackups("openclaw")).toEqual([]);
  });
});
