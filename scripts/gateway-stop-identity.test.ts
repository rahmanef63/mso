import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HARNESS = path.join(process.cwd(), "scripts/test-fixtures/gateway-stop-identity.sh");

describe("gateway_stop_identity", () => {
  it("fails closed when the same process identity survives SIGKILL", () => {
    const result = spawnSync(HARNESS, ["survives"], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("survived SIGKILL; preserving lifecycle state");
  });

  it("succeeds once the recorded identity disappears", () => {
    const result = spawnSync(HARNESS, ["disappears"], { encoding: "utf8" });
    expect(result.status).toBe(0);
  });
});
