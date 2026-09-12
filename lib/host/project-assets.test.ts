import { afterEach, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
let root = "";
afterEach(async () => { vi.unstubAllEnvs(); if (root) await fs.rm(root, { recursive: true, force: true }); });
it("attaches once, refuses overwrites/traversal/symlinks and keeps a durable project copy", async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-project-asset-"));
  vi.stubEnv("OS_FS_WRITE_ROOTS", root); vi.stubEnv("OS_FS_READ_ROOTS", root); vi.resetModules();
  const { attachProjectAsset } = await import("./project-assets");
  const data = Buffer.alloc(24, 1);
  const result = await attachProjectAsset(root, "public/assets/hero.png", data, "image/png");
  expect(result.unchanged).toBe(false); expect(await fs.readFile(result.path)).toEqual(data);
  expect((await attachProjectAsset(root, "public/assets/hero.png", data, "image/png")).unchanged).toBe(true);
  await expect(attachProjectAsset(root, "public/assets/hero.png", Buffer.alloc(24, 2), "image/png")).rejects.toThrow("different content");
  for (const target of ["../outside.png", "/outside.png", "a/../b.png", "a\\b.png", "hero.html"]) await expect(attachProjectAsset(root, target, data, "image/png")).rejects.toThrow();
  await fs.symlink(os.tmpdir(), path.join(root, "link"));
  await expect(attachProjectAsset(root, "link/x.png", data, "image/png")).rejects.toThrow();
});
