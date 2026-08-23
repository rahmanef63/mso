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

  it("makes mso discoverable immediately and persists the user PATH fallback", () => {
    const src = fs.readFileSync(INSTALL, "utf8");
    expect(src).toContain("SYSTEM_CLI=/usr/local/bin/mso");
    expect(src).toContain("# >>> mso cli >>>");
    expect(src).toContain('export PATH="$BIN_DIR:$PATH"');
    expect(src).toContain('command -v mso');
  });
});
