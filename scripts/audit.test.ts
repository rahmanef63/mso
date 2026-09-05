import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function audit(report: string, code = 0, strict = true) {
  const root = mkdtempSync(path.join(tmpdir(), "mso-audit-contract-"));
  chmodSync(root, 0o700); roots.push(root);
  const bin = path.join(root, "bin"); mkdirSync(bin);
  writeFileSync(path.join(bin, "bun"), `#!${process.execPath}\nprocess.stdout.write(process.env.FIXTURE_REPORT ?? '');\nprocess.stderr.write('private-registry-diagnostic');\nprocess.exit(Number(process.env.FIXTURE_EXIT));\n`, { mode: 0o700 });
  return spawnSync(process.execPath, [path.join(process.cwd(), "scripts/audit.mjs"), ...(strict ? ["--strict"] : [])], {
    encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
      FIXTURE_REPORT: report, FIXTURE_EXIT: String(code) }, timeout: 10_000,
  });
}

describe("dependency audit evidence boundary", () => {
  it("accepts a successful empty advisory report", () => {
    const result = audit("{}"); expect(result.status).toBe(0); expect(result.stdout).toContain("(strict)");
  });
  it.each(["", "not json", "null", "[]", '{"pkg":{}}', '{"pkg":[null]}', '{"pkg":[{"severity":"unknown"}]}'])(
    "fails strict mode for incomplete/malformed output %s", (report) => {
      const result = audit(report); expect(result.status).toBe(2);
      expect(result.stderr).toContain("INCOMPLETE"); expect(result.stdout).not.toContain("clean");
      expect(result.stderr).not.toContain("private-registry-diagnostic");
    },
  );
  it("rejects failed processes even if they emit an empty JSON object", () => {
    expect(audit("{}", 1).status).toBe(2); expect(audit("{}", 7).status).toBe(2);
  });
  it("keeps tolerant local mode explicit about skipped evidence", () => {
    const result = audit("", 1, false); expect(result.status).toBe(0);
    expect(result.stderr).toContain("SKIPPED (not a security pass)");
  });
  it("blocks high/critical advisories without printing arbitrary registry fields", () => {
    const result = audit(JSON.stringify({ example: [{ severity: "high", title: "private-registry-diagnostic", url: "https://github.com/advisories/GHSA-test-test-test" }] }), 1);
    expect(result.status).toBe(1); expect(result.stderr).toContain("GHSA-test-test-test");
    expect(result.stderr).not.toContain("private-registry-diagnostic");
  });
  it("applies the documented high/critical threshold to a valid lower-severity report", () => {
    const result = audit(JSON.stringify({ example: [{ severity: "moderate", id: 1 }] }), 1);
    expect(result.status).toBe(0); expect(result.stdout).toContain("clean at high/critical");
  });
});
