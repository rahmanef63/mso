import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appDir } from "./path-credentials";
import { assertDelegatedWritePath } from "./delegated-write";

describe("delegated write control-plane guard", () => {
  it("blocks the live MSO checkout and prospective children", async () => {
    await expect(assertDelegatedWritePath(path.join(appDir(), "package.json"))).rejects.toThrow(/control-plane/);
    await expect(assertDelegatedWritePath(path.join(appDir(), "future", "script.sh"))).rejects.toThrow(/control-plane/);
  });
  it("blocks Git control files in any project", async () => {
    await expect(assertDelegatedWritePath(path.join(os.tmpdir(), "project", ".git", "config"))).rejects.toThrow(/control-plane/);
    await expect(assertDelegatedWritePath(path.join(os.tmpdir(), "project", ".git", "hooks", "post-checkout"))).rejects.toThrow(/control-plane/);
  });
  it("blocks user-systemd unit inputs", async () => {
    await expect(assertDelegatedWritePath(path.join(os.homedir(), ".config/systemd/user/evil.service"))).rejects.toThrow(/control-plane/);
  });
  it("allows ordinary project content", async () => {
    await expect(assertDelegatedWritePath(path.join(os.tmpdir(), "project", "src", "index.ts"))).resolves.toBeUndefined();
  });
  it("blocks CLI launchers used by managed-app probes", async () => {
    for (const dir of [".local/bin", ".bun/bin", ".hermes", ".openclaw"]) {
      await expect(assertDelegatedWritePath(path.join(os.homedir(), dir, "hermes"))).rejects.toThrow(/control-plane/);
    }
    await expect(assertDelegatedWritePath(path.join(os.homedir(), ".local"))).rejects.toThrow(/control-plane/);
  });
});
