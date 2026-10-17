import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

const fixture = `
set -euo pipefail
source scripts/cli/commands-host.sh
ROOT="$PWD"; ENVF=scripts/cli/commands-host.sh
PASS=fixture-password; OS_SESSION_SECRET=fixture-secret
B=http://127.0.0.1:3000; JAR=fixture-cookie
node(){ return 0; }
service_manager_read(){ return 1; }
cli_device(){ printf fixture-device; }
dev_script(){ return 0; }
mso_private_state_remove_file(){ return 0; }
mso_private_state_ensure_file(){ printf '%s' "$1"; }
curl(){ [ "$DOCTOR_RUNTIME_UP" = 1 ] || return 7; printf '{"status":"ok","service":"mso"}'; }
jget(){ [ "$DOCTOR_RUNTIME_UP" = 1 ] || return 7; printf '{"authenticated":true}'; }
mso_cmd_host doctor
`;

const doctor = (template: string, legacyCookieDomain: string, runtimeUp = true) => spawnSync("bash", ["-c", fixture], {
  encoding: "utf8",
  env: {
    ...process.env,
    NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE: template,
    OS_SESSION_COOKIE_DOMAIN: legacyCookieDomain,
    OS_PUBLIC_ORIGIN: "",
    DOCTOR_RUNTIME_UP: runtimeUp ? "1" : "0",
  },
});

it.each([
  ["", ""],
  ["", ".example.com"],
  ["https://{app}.example.com", ""],
  ["https://{app}.example.com", ".example.com"],
])("supports optional dashboard template %s with legacy cookie domain %s", (template, legacyCookieDomain) => {
  const result = doctor(template, legacyCookieDomain);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(template ? `ok    app dashboards (${template})` : "app dashboards    (off:");
  expect(result.stdout).not.toContain("FAIL");
  expect(result.stdout).not.toContain("OS_SESSION_COOKIE_DOMAIN");
  expect(result.stdout).toContain("all good.");
});

it("reports an unavailable runtime without inventing a dashboard configuration failure", () => {
  const result = doctor("", ".example.com", false);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("FAIL  reachable");
  expect(result.stdout).toContain("app dashboards    (off:");
  expect(result.stdout).not.toContain("FAIL  app dashboards");
  expect(result.stdout).not.toContain("all good.");
});
