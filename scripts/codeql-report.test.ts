import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function run(results: unknown[]) {
  const root = mkdtempSync(path.join(tmpdir(), "mso-codeql-report-")); roots.push(root);
  writeFileSync(path.join(root, "result.sarif"), JSON.stringify({
    runs: [{
      tool: { driver: { name: "CodeQL", rules: [{ id: "js/example", properties: { "security-severity": "8.1" } }] } },
      results,
    }],
  }));
  return spawnSync(process.execPath, [path.join(process.cwd(), "scripts/codeql-report.mjs"), root], { encoding: "utf8", timeout: 10_000 });
}

describe("exact CodeQL SARIF inventory", () => {
  it("reports a zero-result analysis", () => {
    const result = run([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("CODEQL_RESULT_COUNT 0");
    expect(result.stdout).toContain("open-alert enforcement runs after GitHub processes this upload");
  });

  it("reports results without treating reviewed SARIF as the open-alert policy", () => {
    const result = run([{
      ruleId: "js/example",
      message: { text: "sensitive diagnostic should never be printed" },
      locations: [{ physicalLocation: { artifactLocation: { uri: "lib/example.ts" }, region: { startLine: 17 } } }],
    }]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("CODEQL_RESULT_COUNT 1");
    expect(result.stdout).toContain("CodeQL SARIF · js/example");
    expect(result.stdout).toContain("lib/example.ts");
    expect(result.stdout).not.toContain("sensitive diagnostic");
    expect(result.stderr).not.toContain("sensitive diagnostic");
  });

  it("does not let a hostile SARIF path escape the annotation boundary", () => {
    const result = run([{
      ruleId: "js/example",
      locations: [{ physicalLocation: { artifactLocation: { uri: "../../secret.env" }, region: { startLine: 3 } } }],
    }]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("file=.github,line=3");
    expect(result.stdout).not.toContain("../../secret.env");
  });
});
