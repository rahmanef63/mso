import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const COMMON = path.join(process.cwd(), "scripts/lib/gateway-common.sh");

function run(body: string) {
  return spawnSync("bash", ["-c", `set -euo pipefail
source ${JSON.stringify(COMMON)}
${body}`], { encoding: "utf8" });
}

describe("gateway_stop_identity", () => {
  it("fails closed when the same process identity survives SIGKILL", () => {
    const result = run(`
gateway_identity_matches() { return 0; }
kill() { return 0; }
sleep() { :; }
gateway_stop_identity '{"pid":4242}'
`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("survived SIGKILL; preserving lifecycle state");
  });

  it("succeeds once the recorded identity disappears", () => {
    const result = run(`
checks=0
gateway_identity_matches() { checks=$((checks+1)); [ "$checks" -lt 3 ]; }
kill() { return 0; }
sleep() { :; }
gateway_stop_identity '{"pid":4242}'
`);
    expect(result.status).toBe(0);
  });
});
