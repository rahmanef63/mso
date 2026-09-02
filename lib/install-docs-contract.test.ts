import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CORE = path.join(__dirname, "../scripts/install-core.sh");
const PHASES = ["cli.sh", "runtime-build.sh", "service.sh", "finalize.sh"].map((name) =>
  path.join(__dirname, "../scripts/install", name),
);
const README = fs.readFileSync(path.join(__dirname, "../README.md"), "utf8");
const INSTALL = fs.readFileSync(path.join(__dirname, "../docs/INSTALL.md"), "utf8");
const AGENTS = fs.readFileSync(path.join(__dirname, "../AGENTS.md"), "utf8");
const core = [CORE, ...PHASES].map((file) => fs.readFileSync(file, "utf8")).join("\n");
const help = execFileSync("bash", [CORE, "--help"], { encoding: "utf8" });

function publicFlags() {
  return help.split("\n")
    .filter((line) => /^  -/.test(line))
    .flatMap((line) => line.match(/--?[a-z][a-z-]*/g) ?? []);
}

function publicEnv() {
  return help.match(/^Env:\s+(.+)$/m)?.[1].match(/MSO_[A-Z0-9_]+/g) ?? [];
}

describe("installer documentation contract", () => {
  it("keeps every public installer flag and env override in README + INSTALL.md", () => {
    expect(publicFlags().length).toBeGreaterThan(5);
    expect(publicEnv().length).toBeGreaterThan(3);
    for (const token of [...publicFlags(), ...publicEnv()]) {
      expect(README, `README missing ${token}`).toContain(token);
      expect(INSTALL, `INSTALL.md missing ${token}`).toContain(token);
    }
    expect(README).toContain("Useful installer controls");
  });

  it("documents one AI-agent path and the legacy-upgrade bridge", () => {
    for (const doc of [README, INSTALL, AGENTS]) {
      expect(doc).toContain("mso doctor");
      expect(doc).toContain("mso update");
      expect(doc).toContain("scripts/install.sh");
    }
    expect(README).toContain("Install or update MSO from this repo");
    expect(INSTALL).toContain("Upgrading an older MSO install");
  });

  it("keeps the installer backward-compatible with an existing service checkout", () => {
    const detect = core.indexOf('systemctl show -p WorkingDirectory --value "$SERVICE"');
    const fresh = core.indexOf('[ -d "$DIR/.git" ] || FRESH_INSTALL=1');
    const checkout = core.indexOf("INSTALL_PHASE=checkout");
    expect(detect).toBeGreaterThan(0);
    expect(detect).toBeLessThan(fresh);
    expect(detect).toBeLessThan(checkout);
    expect(core).toContain('info "found existing service → updating $DIR"');
    expect(core).toContain('if [ ! -f .env.local ]; then');
    expect(core).toContain('.env.local exists — left untouched (existing secrets preserved)');
  });

  it("prints modern update surfaces plus a legacy fallback after installation", () => {
    expect(core).toContain("Update:    mso update");
    expect(core).toContain("Settings → About");
    expect(core).toContain("Legacy:    re-run the official one-line installer");
    expect(core).toContain('ok "mso updated at $DIR"');
    const pairing = core.indexOf("Pair your first device after the API is running");
    const freshGuard = core.lastIndexOf('if [ "$FRESH_INSTALL" -eq 1 ]; then', pairing);
    expect(freshGuard).toBeGreaterThan(0);
  });
});
