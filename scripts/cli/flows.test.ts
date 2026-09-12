import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
it("runs a quoted JSON flow through the shared API and waits for its receipt", () => {
  const script = `
set -euo pipefail
source scripts/cli/flows.sh
die(){ echo "$*" >&2; exit 2; }
enc(){ printf '%s' "$1"; }
jpost(){ [ "$1" = /api/v1/flows ]; jq -e '.project=="project one" and .flow=="custom.echo" and .input.message=="hello world" and .idempotency_key=="once-1"' <<<"$2" >/dev/null; printf '{"id":"abc","state":"running"}'; }
jget(){ [ "$1" = '/api/v1/flows?run_id=abc&wait_ms=25000' ]; printf '{"id":"abc","state":"completed"}'; }
run_flow run custom.echo --project "project one" --input '{"message":"hello world"}' --key once-1 --wait
`;
  expect(JSON.parse(execFileSync("bash", ["-c", script], { encoding: "utf8" }))).toMatchObject({ id: "abc", state: "completed" });
  expect(() => execFileSync("bash", ["-c", script.replace("--key once-1", "")], { encoding: "utf8", stdio: "pipe" })).toThrow();
});
