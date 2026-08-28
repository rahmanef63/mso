import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "../..");
const INSTALL = path.join(ROOT, "scripts/managed-app-install");
const ROUTER = path.join(ROOT, "scripts/managed-app-9router");
const LOCK = path.join(ROOT, "security/managed-app-artifacts.env");
const source = (file: string) => fs.readFileSync(file, "utf8");

describe("managed-app immutable artifact contract", () => {
  it("keeps every executable artifact identity in a reviewed lock file", () => {
    const lock = source(LOCK);
    expect(lock).toMatch(/HERMES_INSTALLER_TAG='v[^']+'/);
    expect(lock).toMatch(/HERMES_INSTALLER_COMMIT='[0-9a-f]{40}'/);
    expect(lock).toMatch(/HERMES_INSTALLER_SHA256='[0-9a-f]{64}'/);
    expect(lock).toMatch(/OPENCLAW_VERSION='[^']+'/);
    expect(lock).toMatch(/OPENCLAW_TARBALL_SHA512='[0-9a-f]{128}'/);
    expect(lock).toMatch(/NINE_ROUTER_IMAGE_REF='[^']+@sha256:[0-9a-f]{64}'/);
  });

  it("verifies Hermes installer bytes and pins the repository checkout", () => {
    const script = source(INSTALL);
    expect(script).toContain("sha256sum -c -");
    expect(script).toContain('--commit "$HERMES_INSTALLER_COMMIT" --force-commit');
    expect(script).toContain("--proto '=https'");
    expect(script).not.toContain("hermes-agent.nousresearch.com/install.sh");
    const executable = script.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");
    expect(executable).not.toMatch(/curl[^\n]+\|\s*(?:ba)?sh/);
  });

  it("verifies an exact OpenClaw tarball before lifecycle scripts can run", () => {
    const script = source(INSTALL);
    expect(script).toContain('npm pack "openclaw@$OPENCLAW_VERSION"');
    expect(script).toContain('sha512sum "$tmp/$tarball"');
    expect(script).toContain('[ "$actual" = "$OPENCLAW_TARBALL_SHA512" ]');
    expect(script).not.toContain("openclaw@latest");
  });

  it("accepts only immutable 9Router references and verifies pulled/running digests", () => {
    const script = source(ROUTER);
    expect(script).toContain("@sha256:");
    expect(script).toContain('^sha256:[0-9a-f]{64}$');
    expect(script).toContain("image_has_expected_digest");
    expect(script).toContain("running_image_matches_lock");
    expect(script).not.toContain("decolua/9router:latest");
    const check = script.slice(script.indexOf("cmd_check() {"), script.indexOf("# Pull latest"));
    expect(check).not.toContain("$BASE/api/version");
  });

  it("keeps both lifecycle scripts syntactically valid", () => {
    expect(() => execFileSync("bash", ["-n", INSTALL])).not.toThrow();
    expect(() => execFileSync("bash", ["-n", ROUTER])).not.toThrow();
  });
});
