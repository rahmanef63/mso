import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "../..");
const INSTALL = path.join(ROOT, "scripts/managed-app-install");
const ROUTER = path.join(ROOT, "scripts/managed-app-9router");
const T3 = path.join(ROOT, "scripts/managed-app-t3");
const N8N = path.join(ROOT, "scripts/managed-app-n8n");
const LOCK = path.join(ROOT, "security/managed-app-artifacts.env");
const source = (file: string) => fs.readFileSync(file, "utf8");

describe("managed-app immutable artifact contract", () => {
  it("keeps every executable artifact identity in a reviewed lock file", () => {
    const lock = source(LOCK);
    expect(lock).toMatch(/HERMES_INSTALLER_TAG='v[^']+'/);
    expect(lock).toMatch(/HERMES_INSTALLER_COMMIT='[0-9a-f]{40}'/);
    expect(lock).toMatch(/HERMES_INSTALLER_SHA256='[0-9a-f]{64}'/);
    expect(lock).toMatch(/HERMES_IMAGE_REF='nousresearch\/hermes-agent@sha256:[0-9a-f]{64}'/);
    expect(lock).toMatch(/OPENCLAW_VERSION='[^']+'/);
    expect(lock).toMatch(/OPENCLAW_TARBALL_SHA512='[0-9a-f]{128}'/);
    expect(lock).toMatch(/NINE_ROUTER_IMAGE_REF='[^']+@sha256:[0-9a-f]{64}'/);
    expect(lock).toMatch(/T3_VERSION='[^']+'/);
    expect(lock).toMatch(/T3_LINUX_X64_SHA256='[0-9a-f]{64}'/);
    expect(lock).toMatch(/T3_LINUX_ARM64_SHA256='[0-9a-f]{64}'/);
    expect(lock).toMatch(/N8N_VERSION='[^']+'/);
    expect(lock).toMatch(/N8N_IMAGE_REF='docker\.n8n\.io\/n8nio\/n8n@sha256:[0-9a-f]{64}'/);
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

  it("pins the Hermes Docker fallback, preserves VPS workspace access, and bounds VFS storage", () => {
    const script = source(INSTALL);
    expect(script).toContain('"$HERMES_RUNTIME_IMAGE" gateway run');
    expect(script).toContain("HERMES_DASHBOARD_HOST=127.0.0.1");
    expect(script).toContain("--restart unless-stopped");
    expect(script).toContain('-v "$HOME:$HOME"');
    expect(script).toContain('config set terminal.cwd "$HOME"');
    expect(script).toContain("io.mso.source-image=$HERMES_IMAGE_REF");
    expect(script).toContain("flattening Hermes for Docker VFS storage");
    expect(script).toContain('exec "${runner[@]}" "${args[@]}" hermes /opt/hermes/hermes "$@"');
    expect(script).not.toContain("nousresearch/hermes-agent:latest");
  });

  it("verifies an exact OpenClaw tarball before lifecycle scripts can run", () => {
    const script = source(INSTALL);
    expect(script).toContain('npm pack "openclaw@$OPENCLAW_VERSION"');
    expect(script).toContain('sha512sum "$tmp/$tarball"');
    expect(script).toContain('[ "$actual" = "$OPENCLAW_TARBALL_SHA512" ]');
    expect(script).not.toContain("openclaw@latest");
    // ONE global-install call site for the whole script: Scorecard PinnedDependenciesID
    // (alert #209) counts every `npm install -g` invocation, comments excluded.
    const globalInstalls = script
      .split("\n")
      .filter((line) => line.trim().startsWith("npm install -g"));
    expect(globalInstalls).toHaveLength(1);
    expect(script).toContain("openclaw_install_verified()");
    const helperCalls = script.split("\n").filter((line) => /(^|\s)openclaw_install_verified(\s|$)/.test(line));
    expect(helperCalls.length).toBeGreaterThanOrEqual(2);
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

  it("verifies pinned T3 Code tarballs by SHA-256 and binds loopback only", () => {
    const script = source(T3);
    expect(script).toContain("sha256sum -c -");
    expect(script).toContain("--proto '=https'");
    expect(script).toContain('BIND="127.0.0.1"');
    expect(script).toContain("--host ${BIND} --port ${PORT}");
    expect(script).not.toContain("releases/latest");
  });

  it("verifies pinned n8n Docker digest, loopback bind, and WebSocket push", () => {
    const script = source(N8N);
    expect(script).toContain("@sha256:");
    expect(script).toContain("image_has_expected_digest");
    expect(script).toContain("running_image_matches_lock");
    expect(script).toContain("0) BIND=127.0.0.1 ;;");
    expect(script).toContain("N8N_PUSH_BACKEND=websocket");
    expect(script).not.toContain("n8nio/n8n:latest");
    expect(script).not.toContain("n8nio/n8n:stable");
  });

  it("keeps all lifecycle scripts syntactically valid", () => {
    expect(() => execFileSync("bash", ["-n", INSTALL])).not.toThrow();
    expect(() => execFileSync("bash", ["-n", ROUTER])).not.toThrow();
    expect(() => execFileSync("bash", ["-n", T3])).not.toThrow();
    expect(() => execFileSync("bash", ["-n", N8N])).not.toThrow();
  });
});
