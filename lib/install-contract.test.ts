import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const INSTALL = path.join(__dirname, "../scripts/install.sh");

describe("one-line installer contract", () => {
  it("is valid bash and documents onboarding controls", () => {
    expect(() => execFileSync("bash", ["-n", INSTALL])).not.toThrow();
    const help = execFileSync("bash", [INSTALL, "--help"], { encoding: "utf8" });
    expect(help).toContain("--onboard");
    expect(help).toContain("--no-onboard");
    expect(help).toContain("-y, --yes");
  });

  it("uses the controlling tty after curl|bash and never stdin for onboarding", () => {
    const src = fs.readFileSync(INSTALL, "utf8");
    expect(src).toContain("[ -r /dev/tty ] && [ -w /dev/tty ]");
    expect(src).toContain('onboard </dev/tty >/dev/tty 2>/dev/tty');
    expect(src).toContain('ONBOARD_MODE=auto');
    expect(src).toContain('FRESH_INSTALL=1');
  });

  it("installs the CLI before service setup and proves it against the invoking PATH", () => {
    const src = fs.readFileSync(INSTALL, "utf8");
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
  });

  it("requires systemd as PID 1 before service setup and gates onboarding on verified health", () => {
    const src = fs.readFileSync(INSTALL, "utf8");
    expect(src).toContain("systemd_ready()");
    expect(src).toContain("/proc/1/comm");
    expect(src).toContain('= "systemd"');
    expect(src).toContain("WSL detected without systemd as PID 1");
    expect(src).toContain("SERVICE_READY=1");
    expect(src).toContain("SERVICE_ATTEMPTED=1");
    expect(src).toContain('elif [ "$SERVICE_ATTEMPTED" -eq 1 ]; then');
    expect(src.indexOf('elif [ "$SERVICE_ATTEMPTED" -eq 1 ]; then')).toBeLessThan(src.indexOf('elif is_wsl; then'));
    expect(src).toContain('systemctl show "$SERVICE" -p MainPID --value');
    expect(src).toContain('[ "$now_pid" -gt 0 ] && [ "$now_pid" != "$prev_pid" ]');
    expect(src).toContain('[ "$RUN_ONBOARD" -eq 1 ] && [ "$SERVICE_READY" -eq 1 ]');
  });

  it("verifies a commit-pinned Bun bootstrap before execution", () => {
    const src = fs.readFileSync(INSTALL, "utf8");
    expect(src).toMatch(/BUN_BOOTSTRAP_COMMIT="[0-9a-f]{40}"/);
    expect(src).toMatch(/BUN_BOOTSTRAP_SHA256="[0-9a-f]{64}"/);
    expect(src).toContain('raw.githubusercontent.com/oven-sh/bun/$BUN_BOOTSTRAP_COMMIT/src/cli/install.sh');
    expect(src).toContain('sha256sum "$bootstrap"');
    expect(src).toContain('[ "$actual" = "$BUN_BOOTSTRAP_SHA256" ]');
    expect(src).not.toContain('https://bun.sh/install | bash');
  });
});
