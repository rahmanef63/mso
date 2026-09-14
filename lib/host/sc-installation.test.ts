import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectScInstallation } from "./sc-installation.mjs";
const roots: string[] = [];
async function fixture(name = "si-coder-agent") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "renamed-sc-worktree-")); roots.push(root);
  await fs.mkdir(path.join(root, "bin"));
  const bin = path.join(root, "bin", "sc-entry.js");
  await fs.writeFile(bin, "// public synthetic entrypoint\n", { mode: 0o700 });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name, version: "0.9.8", bin: { sc: "bin/sc-entry.js" } }), { mode: 0o600 });
  return { root, bin };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
describe("SC package identity", () => {
  it("accepts a renamed worktree and a user-local symlink", async () => {
    const f = await fixture(); const link = path.join(f.root, "sc"); await fs.symlink(f.bin, link);
    expect(await inspectScInstallation(link)).toMatchObject({ root: f.root, name: "si-coder-agent", version: "0.9.8" });
  });
  it("rejects another program named sc without executing it", async () => {
    await expect(inspectScInstallation((await fixture("other-package")).bin)).rejects.toThrow("not_si_coder");
  });
  it("rejects a writable executable", async () => {
    const f = await fixture(); await fs.chmod(f.bin, 0o777);
    await expect(inspectScInstallation(f.bin)).rejects.toThrow("unsafe_sc_binary");
  });
  it("rejects symlinked package metadata instead of checking then reopening it", async () => {
    const f = await fixture();
    const real = path.join(f.root, "package.real.json");
    await fs.rename(path.join(f.root, "package.json"), real);
    await fs.symlink(real, path.join(f.root, "package.json"));
    await expect(inspectScInstallation(f.bin)).rejects.toThrow("unsafe_sc_package");
  });
});
