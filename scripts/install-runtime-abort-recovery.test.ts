import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FIXTURE = path.join(process.cwd(), "scripts/test-fixtures/install-runtime-abort-recovery.sh");

function runCleanup(mode: "pre" | "post") {
  return spawnSync("bash", [FIXTURE, mode], { encoding: "utf8" });
}

describe("installer abort recovery", () => {
  it("restores the known-good service and fallbacks when aborting before mutation", () => {
    const out = runCleanup("pre");
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("release-runtime");
    expect(out.stdout).toContain("sudo systemctl start mso.service");
    expect(out.stdout).toContain("restore-fallbacks");
    expect(out.stdout).toContain("release-update");
  });

  it("does not restart any runtime after installer mutation has started", () => {
    const out = runCleanup("post");
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("release-runtime");
    expect(out.stdout).toContain("release-update");
    expect(out.stdout).not.toContain("systemctl start mso.service");
    expect(out.stdout).not.toContain("restore-fallbacks");
  });
});
