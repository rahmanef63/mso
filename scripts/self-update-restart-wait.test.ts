import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(process.cwd(), "scripts/self-update.sh"), "utf8");

describe("self-update service restart verification budget", () => {
  it("waits long enough for a normal systemd TimeoutStopSec + RestartSec cycle", () => {
    expect(source).toContain('MSO_SERVICE_RESTART_WAIT_SECONDS:-120');
    expect(source).toContain('RESTART_DEADLINE=$((SECONDS + RESTART_WAIT_SECONDS))');
    expect(source).toContain('[ "$RESTART_WAIT_SECONDS" -ge 30 ]');
    expect(source).toContain('[ "$RESTART_WAIT_SECONDS" -le 300 ]');
    expect(source).not.toContain("for _ in $(seq 1 40); do\n  CANDIDATE=");
  });

  it("reports timeout as an unverified release instead of claiming rollback", () => {
    expect(source).toContain("release state is unverified — inspect the system unit before retrying");
  });
});
