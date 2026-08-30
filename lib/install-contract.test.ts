import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

const BOOTSTRAP = path.join(__dirname, "../scripts/install.sh");
const CORE = path.join(__dirname, "../scripts/install-core.sh");

describe("one-line installer contract", () => {
  it("is valid bash and documents onboarding controls", () => {
    expect(() => execFileSync("bash", ["-n", BOOTSTRAP])).not.toThrow();
    expect(() => execFileSync("bash", ["-n", CORE])).not.toThrow();
    const help = execFileSync("bash", [CORE, "--help"], { encoding: "utf8" });
    expect(help).toContain("--onboard");
    expect(help).toContain("--no-onboard");
    expect(help).toContain("-y, --yes");
  });

  it("downloads and verifies the complete installer core before executing any payload bytes", () => {
    const bootstrap = fs.readFileSync(BOOTSTRAP, "utf8");
    const core = fs.readFileSync(CORE);
    expect(Buffer.byteLength(bootstrap)).toBeLessThan(4096);
    expect(bootstrap).toContain("scripts/install-core.sh");
    expect(bootstrap).toContain("installer payload is unexpectedly short");
    expect(bootstrap).toContain("EOF marker missing");
    expect(bootstrap).toContain('bash -n "$TMP_INSTALLER"');
    expect(bootstrap).toContain('bash "$TMP_INSTALLER" "$@"');
    const declared = bootstrap.match(/CORE_SHA256="([0-9a-f]{64})"/)?.[1];
    expect(declared).toBe(crypto.createHash("sha256").update(core).digest("hex"));
    expect(core.toString("utf8").trimEnd().endsWith("# MSO_INSTALLER_CORE_EOF")).toBe(true);
  });

  it("runs the verified local core and rejects a syntactically complete truncated payload", () => {
    const env = { ...process.env, MSO_INSTALL_CORE_URL: `file://${CORE}` };
    const help = execFileSync("bash", [BOOTSTRAP, "--help"], { encoding: "utf8", env });
    expect(help).toContain("mso installer");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mso-installer-truncated-"));
    try {
      const truncated = path.join(dir, "install-core.sh");
      const source = fs.readFileSync(CORE);
      fs.writeFileSync(truncated, source.subarray(0, Math.min(22000, source.length - 1)));
      const result = spawnSync("bash", [BOOTSTRAP, "--help"], {
        encoding: "utf8",
        env: { ...process.env, MSO_INSTALL_CORE_URL: `file://${truncated}` },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/incomplete|hash mismatch|unexpectedly short/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses the controlling tty after curl|bash and never stdin for onboarding", () => {
    const src = fs.readFileSync(CORE, "utf8");
    expect(src).toContain("[ -r /dev/tty ] && [ -w /dev/tty ]");
    expect(src).toContain('onboard </dev/tty >/dev/tty 2>/dev/tty');
    expect(src).toContain('ONBOARD_MODE=auto');
    expect(src).toContain('FRESH_INSTALL=1');
  });

  it("installs the CLI before service setup and proves it against the invoking PATH", () => {
    const src = fs.readFileSync(CORE, "utf8");
    expect(src.indexOf("# ---- CLI on PATH")).toBeLessThan(src.indexOf("# ---- systemd unit ----"));
    expect(src).toContain('PARENT_PATH="${PATH:-}"');
    expect(src).toContain('PARENT_CWD="$PWD"');
    expect(src).toContain('normalize_parent_path()');
    expect(src).toContain('PARENT_PATH_RESOLVED="$(normalize_parent_path "$PARENT_PATH" "$PARENT_CWD")"');
    expect(src).toContain('SYSTEM_BIN_DIR="${MSO_SYSTEM_BIN_DIR:-/usr/local/bin}"');
    expect(src).toContain('PATH="$PARENT_PATH_RESOLVED" command -v mso');
    expect(src).toContain('"$BIN_DIR/mso" -h');
    expect(src).toContain("# >>> mso cli >>>");
    expect(src).toContain('export PATH="$BIN_DIR:$PATH"');
    expect(src).toContain('custom MSO_BIN_DIR is not persisted automatically');
    expect(src).toContain("ensure_cli_tools()");
    expect(src).toContain("curl jq coreutils");
    expect(src).toContain('[ -x "$BIN_DIR/mso" ]');
    expect(src).toContain('CLI launcher self-check failed');
  });

  it("requires systemd as PID 1 before service setup and gates onboarding on verified health", () => {
    const src = fs.readFileSync(CORE, "utf8");
    expect(src).toContain("systemd_ready()");
    expect(src).toContain("/proc/1/comm");
    expect(src).toContain('= "systemd"');
    expect(src).toContain("WSL detected without systemd as PID 1");
    expect(src).toContain("SERVICE_READY=1");
    expect(src).toContain("SERVICE_ATTEMPTED=1");
    expect(src).toContain('elif [ "$SERVICE_ATTEMPTED" -eq 1 ]; then');
    expect(src.indexOf('elif [ "$SERVICE_ATTEMPTED" -eq 1 ]; then')).toBeLessThan(src.indexOf('elif is_wsl; then'));
    expect(src).toContain('RUNTIME_INSTANCE_ID="$(rand_hex 16)"');
    expect(src).toContain('Environment=MSO_RUNTIME_INSTANCE_ID=$RUNTIME_INSTANCE_ID');
    expect(src).toContain('[ "$now_instance" = "$RUNTIME_INSTANCE_ID" ]');
    expect(src).toContain('[ "$RUN_ONBOARD" -eq 1 ] && [ "$SERVICE_READY" -eq 1 ]');
  });

  it("verifies a commit-pinned Bun bootstrap before execution", () => {
    const src = fs.readFileSync(CORE, "utf8");
    expect(src).toMatch(/BUN_BOOTSTRAP_COMMIT="[0-9a-f]{40}"/);
    expect(src).toMatch(/BUN_BOOTSTRAP_SHA256="[0-9a-f]{64}"/);
    expect(src).toContain('raw.githubusercontent.com/oven-sh/bun/$BUN_BOOTSTRAP_COMMIT/src/cli/install.sh');
    expect(src).toContain('sha256sum "$bootstrap"');
    expect(src).toContain('[ "$actual" = "$BUN_BOOTSTRAP_SHA256" ]');
    expect(src).not.toContain('https://bun.sh/install | bash');
  });
});
