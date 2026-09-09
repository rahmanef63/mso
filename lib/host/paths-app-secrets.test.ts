import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "mso-app-secrets-")));
const fakeHome = path.join(base, "home");
const appDir = path.join(base, "app");
const secret = path.join(appDir, ".env.local");
let guards: typeof import("./paths");
beforeAll(async () => {
  for (const dir of [appDir, path.join(fakeHome, ".ssh"), path.join(fakeHome, ".mso")]) mkdirSync(dir, { recursive: true });
  writeFileSync(secret, "# synthetic; no credentials");
  writeFileSync(path.join(appDir, ".env.example"), "# public example");
  writeFileSync(path.join(appDir, "package.json"), "{}");
  vi.stubEnv("HOME", fakeHome);
  vi.stubEnv("OS_FS_READ_ROOTS", base);
  vi.stubEnv("OS_FS_ALLOW_SENSITIVE", "0");
  vi.resetModules();
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(appDir);
  try { guards = await import("./paths"); } finally { cwd.mockRestore(); }
});
afterAll(() => { vi.unstubAllEnvs(); rmSync(base, { recursive: true, force: true }); });

describe("credential denylist with real synthetic files", () => {
  it.each([".ssh", ".mso"])("blocks %s even inside a legal root", async name => {
    await expect(guards.resolveReadable(path.join(fakeHome, name))).rejects.toThrow(/credential|sensitive/i);
  });
  it("blocks the app's own .env.local", async () => {
    await expect(guards.resolveReadable(secret)).rejects.toThrow(/credential|sensitive/i);
  });
  it("still allows .env.example", async () => {
    await expect(guards.resolveReadable(path.join(appDir, ".env.example"))).resolves.toBe(path.join(appDir, ".env.example"));
  });
  it("copy skips secrets when a parent of the app is the source", () => {
    const filter = guards.appSecretCopyFilter(base);
    expect(filter).toBeTypeOf("function");
    expect(filter!(secret)).toBe(false);
    expect(filter!(path.join(appDir, "package.json"))).toBe(true);
    expect(filter!(path.join(appDir, ".env.example"))).toBe(true);
  });
  it("move refuses so its EXDEV branch cannot delete a skipped secret", () => {
    expect(() => guards.assertNoAppSecretDescendants(base)).toThrow(/secret/i);
  });
  it("leaves an unrelated source alone", () => {
    expect(guards.appSecretCopyFilter(path.join(base, "elsewhere"))).toBeUndefined();
    expect(() => guards.assertNoAppSecretDescendants(path.join(base, "elsewhere"))).not.toThrow();
  });
  it("leaves direct app copies to the per-path gate", () => {
    expect(guards.appSecretCopyFilter(appDir)).toBeUndefined();
    expect(() => guards.assertNoAppSecretDescendants(appDir)).not.toThrow();
  });
});
