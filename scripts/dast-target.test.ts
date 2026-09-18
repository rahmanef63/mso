import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { requireDastTarget } from "./check-dast-target.mjs";

describe("passive DAST requires an explicit safe target", () => {
  it.each([undefined, "", " ", "not-a-url", "http://scan.example.com", "https://user:secret@scan.example.com", "https://scan.example.com/?token=secret", "https://scan.example.com/#secret", "https://scan.example.com\n", "https://scan.example.com/" + "a".repeat(2048)])("rejects an absent or inappropriate target (%#)", value => {
    expect(() => requireDastTarget(value)).toThrow(/MSO_DAST_URL/);
  });
  it("accepts explicit deployment-owned HTTPS roots and paths without making requests", () => {
    expect(requireDastTarget("https://scan.example.com")).toBe("https://scan.example.com/");
    expect(requireDastTarget("https://scan.example.com:8443/app")).toBe("https://scan.example.com:8443/app");
  });
  it("fails the actual command on missing configuration without echoing secrets", () => {
    for (const value of ["", "https://user:private-value@scan.example.com"]) {
      const result = spawnSync(process.execPath, ["scripts/check-dast-target.mjs"], { encoding: "utf8", env: { ...process.env, MSO_DAST_URL: value } });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("MSO_DAST_URL");
      expect(result.stderr).not.toContain("private-value");
    }
  });
  it("runs the target guard before an unconditional passive scanner with unchanged alert policy", () => {
    const workflow = readFileSync(".github/workflows/dast.yml", "utf8");
    const guard = workflow.indexOf("run: node scripts/check-dast-target.mjs");
    const scan = workflow.indexOf("uses: zaproxy/action-baseline@");
    expect(guard).toBeGreaterThan(0); expect(scan).toBeGreaterThan(guard);
    expect(workflow).not.toMatch(/^\s*if:/m);
    expect(workflow).toContain("MSO_DAST_URL: ${{ vars.MSO_DAST_URL }}");
    expect(workflow).toContain("fail_action: true");
    expect(workflow).toContain("allow_issue_writing: false");
    expect(workflow).toContain("rules_file_name: security/zap-baseline.conf");
    expect(workflow).not.toContain("-I");
  });
});
