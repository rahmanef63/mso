import { execFileSync, spawnSync } from "node:child_process";
import { expect, it } from "vitest";

const fixture = `
set -euo pipefail
source scripts/cli/managed-apps.sh
die(){ echo "$*" >&2; exit 1; }
enc(){ printf '%s' "$1"; }
kv_args(){ printf '{}'; }
jget(){ [ "$1" = /api/v1/managed-apps/9router ]; printf '{"app":{"installed":false}}'; }
jpost(){
  if [ "$1" = /api/v1/managed-apps/9router/install ]; then printf '{"job":{"id":"job-one"}}';
  else [ "$1" = /api/v1/managed-apps/9router ]; jq -e '.action=="start"' <<<"$2" >/dev/null; printf '{"app":{"installed":true,"state":"running","domain":{"phase":"ready"}}}'; fi
}
wait_managed_job(){ [ "$1" = 9router ] && [ "$2" = job-one ]; echo 'waited for install'; }
`;

it("enables a missing app through install, job completion and the shared start API", () => {
  const result = spawnSync("bash", ["-c", fixture + "mso_mapp_enable 9router"], { encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).app).toMatchObject({ installed: true, state: "running", domain: { phase: "ready" } });
  expect(result.stderr).toContain("waited for install");
});
it("keeps an installed app and reports DNS attention through a nonzero exit", () => {
  const script = fixture + `
jget(){ printf '{"app":{"installed":true}}'; }
jpost(){ [ "$1" = /api/v1/managed-apps/9router ]; printf '{"app":{"state":"running","domainDiagnostic":"certificate pending"}}'; }
mso_mapp_enable 9router
`;
  const result = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  expect(result.status).toBe(2);
  expect(JSON.parse(result.stdout).app.state).toBe("running");
  expect(result.stderr).toContain("domain setup needs attention");
});
it("refuses invalid IDs and fails before start when installation failed", () => {
  expect(() => execFileSync("bash", ["-c", fixture + "mso_mapp_enable other"], { stdio: "pipe" })).toThrow();
  expect(() => execFileSync("bash", ["-c", fixture + '\nwait_managed_job(){ return 1; }\nmso_mapp_enable 9router'], { stdio: "pipe" })).toThrow();
});
it("preserves a failed lifecycle request instead of reporting a successful action", () => {
  const result = spawnSync("bash", ["-c", fixture + '\njpost(){ echo "request failed" >&2; return 22; }\nmso_mapp_lifecycle start 9router'], { encoding: "utf8" });
  expect(result.status).toBe(22);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("request failed");
});
