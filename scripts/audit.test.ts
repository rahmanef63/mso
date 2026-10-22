import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function audit(report: string, code = 0, strict = true, version = "1.3.14", flaky = 0, receipt?: string) {
  const root = mkdtempSync(path.join(tmpdir(), "mso-audit-contract-"));
  chmodSync(root, 0o700); roots.push(root);
  const bin = path.join(root, "bin"); mkdirSync(bin);
  writeFileSync(path.join(bin, "bun"), `#!${process.execPath}
const fs=require('node:fs');
if(process.argv[2]==='--version'){console.log(process.env.FIXTURE_BUN_VERSION);process.exit(0)}
const counter=process.env.FIXTURE_COUNTER;
let seen=0;
try{seen=Number(fs.readFileSync(counter,'utf8'))||0}catch{}
fs.writeFileSync(counter,String(seen+1));
if(seen < Number(process.env.FIXTURE_FLAKY)){process.exit(1)}
process.stdout.write(process.env.FIXTURE_REPORT ?? '');
process.stderr.write('private-registry-diagnostic');
process.exit(Number(process.env.FIXTURE_EXIT));
`, { mode: 0o700 });
  return spawnSync(process.execPath, [path.join(process.cwd(), "scripts/audit.mjs"), ...(strict ? ["--strict"] : [])], {
    encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
      FIXTURE_BUN_VERSION: version, FIXTURE_REPORT: report, FIXTURE_EXIT: String(code),
      FIXTURE_FLAKY: String(flaky), FIXTURE_COUNTER: path.join(root, "counter"),
      MSO_AUDIT_BACKOFF_MS: "5", MSO_AUDIT_RECEIPT: receipt ?? path.join(root, "receipt.json") }, timeout: 15_000,
  });
}

describe("dependency audit evidence boundary", () => {
  it("refuses Bun without native audit before any recursive script resolution", () => {
    const result = audit("{}", 0, true, "1.2.14");
    expect(result.status).toBe(2); expect(result.stderr).toContain("Bun >=1.2.15");
  });
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
  it("does not exempt the formerly waived braces advisory", () => {
    for (const pkg of ["braces", "micromatch"]) {
      const result = audit(JSON.stringify({ [pkg]: [{ severity: "high", url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm" }] }), 1);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("GHSA-vfj7-8cjw-p6xm");
    }
  });
  it("retries an inconclusive registry probe before giving up", () => {
    const result = audit("{}", 0, true, "1.3.14", 2);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("retrying in");
    expect(result.stdout).toContain("clean at high/critical");
  });
  it("distinguishes an unreachable registry from advisories without prior clean evidence", () => {
    const result = audit("", 0, true, "1.3.14", 9);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("registry unreachable");
    expect(result.stderr).not.toContain("advisories");
    expect(result.stdout).not.toContain("clean");
  });
  it("reuses only a fresh lockfile-matched clean audit when the registry stays silent", () => {
    const shared = path.join(tmpdir(), `mso-audit-receipt-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
    const clean = audit("{}", 0, true, "1.3.14", 0, shared);
    expect(clean.status).toBe(0);
    const silent = audit("", 0, true, "1.3.14", 9, shared);
    expect(silent.status).toBe(0);
    expect(silent.stdout).toContain("reusing clean lockfile audit");
    // A stale receipt (older than the window) must fail closed again.
    writeFileSync(shared, JSON.stringify({ lockfile: JSON.parse(readFileSync(shared, "utf8")).lockfile, at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() }), { mode: 0o600 });
    const stale = audit("", 0, true, "1.3.14", 9, shared);
    expect(stale.status).toBe(2);
    expect(stale.stderr).toContain("registry unreachable");
    rmSync(shared, { force: true });
  });
  it("applies the documented high/critical threshold to a valid lower-severity report", () => {
    const result = audit(JSON.stringify({ example: [{ severity: "moderate", id: 1 }] }), 1);
    expect(result.status).toBe(0); expect(result.stdout).toContain("clean at high/critical");
  });
});
