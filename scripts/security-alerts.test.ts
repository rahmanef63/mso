import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function run(options: { count?: number; denied?: boolean; noAnalysis?: boolean; paginate?: boolean; stale?: boolean; hostile?: boolean } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "mso-alert-report-test-")); roots.push(root);
  const stub = `const options=${JSON.stringify(options)};
    globalThis.fetch=async(url)=>{
      if(options.denied)return new Response('{}',{status:403});
      let value={default_branch:'main'};let headers={};
      if(url.includes('/branches/'))value={commit:{sha:'a'.repeat(40)}};
      if(url.includes('/alerts?')){value=Array.from({length:options.count??0},(_,i)=>({number:i+1,state:'open',tool:{name:'CodeQL'},rule:{id:options.hostile?'js/test%0A::error::boom':'js/test',severity:'warning',security_severity_level:'high'}}));
        if(options.paginate){if(url.includes('page=2'))value=[];else headers={link:'<https://api.github.com/next>; rel="next"'};}}
      if(url.includes('/instances?'))value=[{ref:'refs/heads/main',state:'open',location:{path:options.hostile?'../escape.ts':'lib/test.ts',start_line:3},message:{text:'review me'}}];
      if(url.includes('/analyses?'))value=options.noAnalysis?[]:[{id:1,commit_sha:(options.stale?'b':'a').repeat(40),tool:{name:'CodeQL'},ref:'refs/heads/main'}];
      return new Response(JSON.stringify(value),{status:200,headers});
    };await import(${JSON.stringify(path.join(process.cwd(), "scripts/security-alerts.mjs"))});`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", stub], { encoding: "utf8", timeout: 10_000,
    env: { NODE_ENV: "test", PATH: process.env.PATH, GITHUB_TOKEN: "synthetic-test-value", GITHUB_REPOSITORY: "example/repository", RUNNER_TEMP: root } });
  let report: { openCount: number; alerts: unknown[]; ref: string } | undefined;
  try { report = JSON.parse(result.stdout.split("\n").find((line) => line.startsWith("CODE_SCANNING_REPORT "))!.slice("CODE_SCANNING_REPORT ".length)); } catch { /* failed evidence is expected in negative cases */ }
  return { ...result, report };
}
describe("GitHub open-alert evidence", () => {
  it("does not turn 21 open alerts into a successful security check", () => {
    const result = run({ count: 21 }); expect(result.status).toBe(1); expect(result.report?.openCount).toBe(21);
    expect(result.stdout).not.toContain("synthetic-test-value"); expect(result.stderr).not.toContain("synthetic-test-value");
    expect(result.stdout).toContain("::warning file=lib/test.ts,line=3,title=Code scanning #1 · js/test::high finding remains open");
  });
  it("sanitizes workflow-command metadata before exposing alert annotations", () => {
    const result = run({ count: 1, hostile: true });
    expect(result.status).toBe(1); expect(result.stdout).toContain("file=.github,line=3");
    expect(result.stdout).toContain("%250A"); expect(result.stdout).not.toContain("\n::error::boom");
  });
  it("accepts zero findings only with scan evidence", () => { const result = run(); expect(result.status).toBe(0); expect(result.report?.openCount).toBe(0); });
  it("fails closed on a denied security inventory", () => { const result = run({ denied: true }); expect(result.status).toBe(2); expect(result.stderr).toContain("INCOMPLETE"); });
  it("does not call an old clean scan current", () => { expect(run({ stale: true }).status).toBe(2); });
  it("does not call an unscanned repository clean", () => { expect(run({ noAnalysis: true }).status).toBe(2); });
  it("follows pagination instead of treating a first page as the complete inventory", () => { const result = run({ count: 2, paginate: true }); expect(result.status).toBe(1); expect(result.report?.alerts).toHaveLength(2); });
});
