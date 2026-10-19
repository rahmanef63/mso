import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readOrcaPrivateFile, resolveOrcaManagedRoot } from "./orca-private-fs";

const roots: string[] = [];
async function makeRoot(mode = 0o700): Promise<string> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mso-orca-fs-"));
  await chmod(tmp, mode);
  roots.push(tmp);
  return tmp;
}

afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

describe("resolveOrcaManagedRoot", () => {
  it("uses the portable default under the owner home, never the personal ~/.orca", () => {
    const result = resolveOrcaManagedRoot({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.root).toBe(path.join(os.homedir(), ".local", "share", "mso", "orca"));
      expect(result.root).not.toContain(`${path.sep}.orca-remote`);
      expect(path.basename(result.root)).not.toBe(".orca");
    }
  });

  it("accepts a clean absolute ORCA_HOME and rejects relative, dot-dot, and NUL config", () => {
    const abs = resolveOrcaManagedRoot({ ORCA_HOME: "/var/lib/mso/orca" });
    expect(abs).toEqual({ ok: true, root: "/var/lib/mso/orca" });
    expect(resolveOrcaManagedRoot({ ORCA_HOME: "relative/orca" }).ok).toBe(false);
    expect(resolveOrcaManagedRoot({ ORCA_HOME: "/var/lib/../../etc/orca" }).ok).toBe(false);
    expect(resolveOrcaManagedRoot({ ORCA_HOME: "  " })).toEqual({ ok: false, reason: "managed_root_invalid" });
    expect(resolveOrcaManagedRoot({ ORCA_HOME: "/var\0lib" }).ok).toBe(false);
  });
});

describe("readOrcaPrivateFile", () => {
  it("reads a 0600 regular file inside a 0700 owner directory", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "runtime-identity.json"), `{"a":1}`, { mode: 0o600 });
    const result = await readOrcaPrivateFile(root, "runtime-identity.json");
    expect(result).toEqual({ ok: true, text: `{"a":1}` });
  });

  it("reports missing for an absent file or absent root", async () => {
    const root = await makeRoot();
    expect(await readOrcaPrivateFile(root, "private-status.json")).toEqual({ ok: false, reason: "missing" });
    expect(await readOrcaPrivateFile(path.join(root, "nope"), "private-status.json")).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects a group/other-readable file and a group/other-accessible directory", async () => {
    const root = await makeRoot();
    const file = path.join(root, "private-status.json");
    await writeFile(file, "{}", { mode: 0o600 });
    await chmod(file, 0o644);
    expect(await readOrcaPrivateFile(root, "private-status.json")).toEqual({ ok: false, reason: "insecure" });

    await chmod(file, 0o600);
    await chmod(root, 0o755);
    expect(await readOrcaPrivateFile(root, "private-status.json")).toEqual({ ok: false, reason: "insecure" });
  });

  it("rejects a symlinked final component instead of following it", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "real.json"), "{}", { mode: 0o600 });
    await symlink(path.join(root, "real.json"), path.join(root, "private-status.json"));
    expect(await readOrcaPrivateFile(root, "private-status.json")).toEqual({ ok: false, reason: "insecure" });
  });

  it("rejects a symlinked ancestor directory", async () => {
    const parent = await makeRoot();
    const real = path.join(parent, "real");
    await mkdir(real, { mode: 0o700 });
    await symlink(real, path.join(parent, "link"));
    await writeFile(path.join(real, "private-status.json"), "{}", { mode: 0o600 });
    expect(await readOrcaPrivateFile(path.join(parent, "link"), "private-status.json")).toEqual({ ok: false, reason: "insecure" });
  });

  it("refuses to read an unknown filename", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "anything.json"), "{}", { mode: 0o600 });
    expect(await readOrcaPrivateFile(root, "anything.json")).toEqual({ ok: false, reason: "insecure" });
  });

  it("refuses a file larger than the bounded cap before reading bytes", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "private-status.json"), "x".repeat(70000), { mode: 0o600 });
    expect(await readOrcaPrivateFile(root, "private-status.json")).toEqual({ ok: false, reason: "insecure" });
  });
});
