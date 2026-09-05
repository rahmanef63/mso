import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function run(options: { count?: number; denied?: boolean; noAnalysis?: boolean; paginate?: boolean; stale?: boolean } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "mso-alert-report-test-")); roots.push(root);
  const stub = `const options=${JSON.stringify(options)};
    globalThis.fetch=async(url)=>{
      if(options.denied)return new Response('{}',{status:403});
      let value={default_branch:'main'};let headers={};
      if(url.includes('/branches/'))value={commit:{sha:'a'.repeat(40)}};
      if(url.includes('/alerts?')){value=Array.from({length:options.count??0},(_,i)=>({number:i+1,state:'open',tool:{name:'CodeQL'},rule:{id:'js/test',severity:'warning'}}));
        if(options.paginate){if(url.includes('page=2'))value=[];else headers={link:'<https://api.github.com/next>; rel="next"'};}}
      if(url.includes('/instances?'))value=[{ref:'refs/heads/main',state:'open',location:{path:'lib/test.ts',start_line:3},message:{text:'review me'}}];
      if(url.includes('/analyses?'))value=options.noAnalysis?[]:[{id:1,commit_sha:(options.stale?'b':'a').repeat(40),tool:{name:'CodeQL'},ref:'refs/heads/main'}];
      return new Response(JSON.stringify(value),{status:200,headers});
    };await import(${JSON.stringify(path.join(process.cwd(), "scripts/security-alerts.mjs"))});`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", stub], { encoding: "utf8", timeout: 10_000,
    env: { NODE_ENV: "test", PATH: process.env.PATH, GITHUB_TOKEN: "synthetic-test-value", GITHUB_REPOSITORY: "example/repository", RUNNER_TEMP: root } });
  const reportDir = readdirSync(root).find((name) => name.startsWith("mso-code-scanning-"));
  let report: { openCount: number; alerts: unknown[] } | undefined;
  try { report = JSON.parse(readFileSync(path.join(root, reportDir ?? "", "code-scanning.json"), "utf8")); } catch { /* failed evidence is expected in negative cases */ }
  return { ...result, report };
}
describe("GitHub open-alert evidence", () => {
  it("does not turn 21 open alerts into a successful security check", () => {
    const result = run({ count: 21 }); expect(result.status).toBe(1); expect(result.report?.openCount).toBe(21);
    expect(result.stdout).not.toContain("synthetic-test-value"); expect(result.stderr).not.toContain("synthetic-test-value");
  });
  it("accepts zero findings only with scan evidence", () => { const result = run(); expect(result.status).toBe(0); expect(result.report?.openCount).toBe(0); });
  it("fails closed on a denied security inventory", () => { const result = run({ denied: true }); expect(result.status).toBe(2); expect(result.stderr).toContain("INCOMPLETE"); });
  it("does not call an old clean scan current", () => { expect(run({ stale: true }).status).toBe(2); });
  it("does not call an unscanned repository clean", () => { expect(run({ noAnalysis: true }).status).toBe(2); });
  it("follows pagination instead of treating a first page as the complete inventory", () => { const result = run({ count: 2, paginate: true }); expect(result.status).toBe(1); expect(result.report?.alerts).toHaveLength(2); });
});
