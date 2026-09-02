import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const ULTIMATE = path.join(ROOT, "scripts/security-ultimate.sh");

describe("security scanner supply chain", () => {
  it("pins OSV release binaries by official version and SHA-256 instead of a mutable/denied container ref", () => {
    const script = fs.readFileSync(ULTIMATE, "utf8");
    expect(script).toContain("OSV_VERSION='2.5.1'");
    expect(script).toContain("OSV_LINUX_AMD64_SHA256='f9f25499a2c8cc367b3af45df2ea7eeca7fbccceab9c35079968f4b3652194be'");
    expect(script).toContain("OSV_LINUX_ARM64_SHA256='3d0f5aa5a6baa8eb32bcef247388e149ef6030a6634ccae6fa0d62681fb27a6d'");
    expect(script).toContain("releases/download/v${OSV_VERSION}/${asset}");
    expect(script).toContain("sha256sum -c -");
    expect(script).toContain('if [[ -L "$OSV_BIN" ]]');
    expect(script).not.toContain("OSV_IMAGE=");
    expect(script).not.toContain("osv-scanner:latest");
  });

  it("runs the verified binary from owner-local state with an ephemeral HOME", () => {
    const script = fs.readFileSync(ULTIMATE, "utf8");
    expect(script).toContain('OSV_TOOLS="$STATE_BASE/tools/osv-scanner/$OSV_VERSION"');
    expect(script).toContain('run_capture "OSV binary integrity" prepare_osv');
    expect(script).toContain('run_capture "OSV dependencies" env HOME="$OSV_HOME" "$OSV_BIN" scan source --recursive "$SRC"');
  });
});
