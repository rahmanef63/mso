import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function run(options: { count?: number; scorecard?: boolean; filterIgnored?: boolean; denied?: boolean; noAnalysis?: boolean; paginate?: boolean; stale?: boolean; hostile?: boolean; args?: string[]; readyAfter?: number; branchMoved?: boolean; wrongRef?: boolean; analysisError?: boolean; invalidAnalysis?: boolean; message?: string; scannerToml?: string | null } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "mso-alert-report-test-")); roots.push(root);
  // An explicit osv-scanner.toml needs its own script copy so the reviewed-exception
  // lookup resolves inside this fixture root instead of the real checkout.
  let script = path.join(process.cwd(), "scripts/security-alerts.mjs");
  if (options.scannerToml !== undefined) {
    const scripts = path.join(root, "scripts");
    mkdirSync(scripts, { recursive: true });
    copyFileSync(script, path.join(scripts, "security-alerts.mjs"));
    if (options.scannerToml) writeFileSync(path.join(root, "osv-scanner.toml"), options.scannerToml);
    script = path.join(scripts, "security-alerts.mjs");
  }
  const stub = `const options=${JSON.stringify(options)};
    process.argv=['node','security-alerts.mjs',...(options.args??[])];
    let clock=0,analyses=0,branches=0,waits=0,inventories=0;
    Date.now=()=>clock;
    globalThis.setTimeout=(callback,ms)=>{clock+=ms;waits++;queueMicrotask(callback);return 1;};
    globalThis.fetch=async(url)=>{
      if(options.denied)return new Response('{}',{status:403});
      let value={default_branch:'main'};let headers={};
      if(url.includes('/branches/'))value={commit:{sha:(++branches>1&&options.branchMoved?'b':'a').repeat(40)}};
      if(url.includes('/alerts?')){inventories++;value=Array.from({length:options.count??0},(_,i)=>({number:i+1,state:'open',tool:{name:'CodeQL'},rule:{id:options.hostile?'js/test%0A::error::boom':'js/test',severity:'warning',security_severity_level:'high'}}));
        if(options.scorecard&&(!url.includes('tool_name=CodeQL')||options.filterIgnored))value.push({number:137,state:'open',tool:{name:'Scorecard'},rule:{id:'SASTID',security_severity_level:'medium'}});
        if(options.paginate){if(url.includes('page=2'))value=[];else headers={link:'<https://api.github.com/next>; rel="next"'};}}
      if(url.includes('/instances?'))value=[{ref:'refs/heads/main',state:'open',location:{path:options.hostile?'../escape.ts':'lib/test.ts',start_line:3},message:{text:options.message??'review me'}}];
      if(url.includes('/analyses?')){analyses++;value=options.invalidAnalysis?{}:options.noAnalysis?[]:[{id:1,commit_sha:(options.stale||analyses<=(options.readyAfter??0)?'b':'a').repeat(40),tool:{name:'CodeQL'},ref:options.wrongRef?'refs/heads/other':'refs/heads/main',error:options.analysisError?'failed':''}];}
      return new Response(JSON.stringify(value),{status:200,headers});
    };await import(${JSON.stringify(script)});console.log('FETCH_COUNTS '+JSON.stringify({analyses,branches,waits,inventories}));`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", stub], { encoding: "utf8", timeout: 10_000,
    env: { NODE_ENV: "test", PATH: process.env.PATH, GITHUB_TOKEN: "synthetic-test-value", GITHUB_REPOSITORY: "example/repository", RUNNER_TEMP: root } });
  let report: { openCount: number; alerts: unknown[]; closed: unknown[]; ref: string; tool: string } | undefined;
  try { report = JSON.parse(result.stdout.split("\n").find((line) => line.startsWith("CODE_SCANNING_REPORT "))!.slice("CODE_SCANNING_REPORT ".length)); } catch { /* failed evidence is expected in negative cases */ }
  const counts = JSON.parse(result.stdout.split("\n").find((line) => line.startsWith("FETCH_COUNTS "))?.slice(13) ?? "{}");
  return { ...result, report, counts };
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
  it("still fails the default all-tool inventory on Scorecard findings", () => {
    const result = run({ scorecard: true });
    expect(result.status).toBe(1); expect(result.report).toMatchObject({ openCount: 1, tool: "all" });
    expect(result.stdout).toContain('"tool":"Scorecard"');
  });
  it("scopes CodeQL open and closed queries without masking an open CodeQL alert", () => {
    const args = ["--tool", "CodeQL", "--include-closed"];
    const clean = run({ scorecard: true, args });
    expect(clean.status).toBe(0); expect(clean.report).toMatchObject({ openCount: 0, closed: [], tool: "CodeQL" });
    const finding = run({ scorecard: true, count: 1, args });
    expect(finding.status).toBe(1); expect(finding.report?.openCount).toBe(1);
  });
  it("fails closed when the API does not honor the selected tool", () => {
    const result = run({ scorecard: true, filterIgnored: true, args: ["--tool", "CodeQL"] });
    expect(result.status).toBe(2); expect(result.stderr).toContain("Unexpected tool");
  });
  it.each(["Scorecard", "", "--inventory"])("rejects unsupported tool selection: %s", (tool) => {
    expect(run({ args: ["--tool", tool] }).status).not.toBe(0);
  });
});


describe("reviewed OSV exceptions do not double-count a Scorecard advisory", () => {
  // The stub pins Date.now to the epoch, so these dates bracket that clock
  // deterministically instead of depending on when the suite runs.
  const activeToml = '[[IgnoredVulns]]\nid = "GHSA-gcqx-w48m-w2h4"\nignoreUntil = 2999-01-01T00:00:00Z\nreason = """test fixture"""\n';
  const expiredToml = '[[IgnoredVulns]]\nid = "GHSA-gcqx-w48m-w2h4"\nignoreUntil = 1969-12-31T00:00:00Z\nreason = """test fixture"""\n';
  const advisory = (id: string) => `score is 9: 1 existing vulnerabilities detected: Warn: Project is vulnerable to: https://osv.dev/${id}`;
  it("skips a Scorecard alert naming an active reviewed advisory", () => {
    const result = run({ scorecard: true, message: advisory("GHSA-gcqx-w48m-w2h4"), scannerToml: activeToml });
    expect(result.status).toBe(0);
    expect(result.report).toMatchObject({ openCount: 0, tool: "all" });
    expect(result.stdout).toContain("REVIEWED_EXCEPTION 137 GHSA-gcqx-w48m-w2h4 2999-01-01T00:00:00Z");
    expect(result.stdout).not.toContain("title=Code scanning #137");
  });
  it("still fails a Scorecard alert whose reviewed exception has expired", () => {
    const result = run({ scorecard: true, message: advisory("GHSA-gcqx-w48m-w2h4"), scannerToml: expiredToml });
    expect(result.status).toBe(1);
    expect(result.report?.openCount).toBe(1);
    expect(result.stdout).not.toContain("REVIEWED_EXCEPTION");
  });
  it("still fails a Scorecard alert naming an advisory that is not recorded", () => {
    const result = run({ scorecard: true, message: advisory("GHSA-0000-0000-0000"), scannerToml: activeToml });
    expect(result.status).toBe(1);
    expect(result.report?.openCount).toBe(1);
    expect(result.stdout).not.toContain("REVIEWED_EXCEPTION");
  });
  it("does not extend a reviewed exception to CodeQL findings", () => {
    const result = run({ count: 1, message: advisory("GHSA-gcqx-w48m-w2h4"), scannerToml: activeToml });
    expect(result.status).toBe(1);
    expect(result.report?.openCount).toBe(1);
    expect(result.stdout).not.toContain("REVIEWED_EXCEPTION");
  });
  it("treats a missing osv-scanner.toml as no reviewed exceptions", () => {
    const result = run({ scorecard: true, message: advisory("GHSA-gcqx-w48m-w2h4"), scannerToml: "" });
    expect(result.status).toBe(1);
    expect(result.report?.openCount).toBe(1);
  });
});


describe("bounded exact-commit CodeQL readiness", () => {
  const args = ["--wait-seconds", "30", "--commit", "a".repeat(40)];
  it("waits for the pushed commit rather than failing on a previous clean analysis", () => {
    const result = run({ args, readyAfter: 2 });
    expect(result.status).toBe(0); expect(result.counts.waits).toBe(2); expect(result.counts.inventories).toBe(1);
    expect(result.stdout).toContain("WAITING_FOR_CODEQL refs/heads/main");
  });
  it("still fails on open alerts after the current analysis arrives", () => {
    const result = run({ args, readyAfter: 1, count: 2 });
    expect(result.status).toBe(1); expect(result.report?.openCount).toBe(2);
  });
  it.each([{ noAnalysis: true }, { stale: true }, { wrongRef: true }])("fails closed at the wait bound: %j", (options) => {
    const result = run({ args, ...options });
    expect(result.status).toBe(2); expect(result.counts.waits).toBe(3); expect(result.counts.inventories).toBe(0);
  });
  it.each([{ denied: true }, { analysisError: true }, { invalidAnalysis: true }])("does not retry non-readiness failures: %j", (options) => {
    const result = run({ args, ...options });
    expect(result.status).toBe(2); expect(result.counts.waits).toBe(0); expect(result.counts.inventories).toBe(0);
  });
  it("rejects a changed branch while waiting", () => {
    const result = run({ args, readyAfter: 2, branchMoved: true });
    expect(result.status).toBe(2); expect(result.stderr).toContain("Branch changed"); expect(result.counts.inventories).toBe(0);
  });
  it("rejects an obsolete requested commit before querying scan evidence", () => {
    const result = run({ args: ["--commit", "b".repeat(40)] });
    expect(result.status).toBe(2); expect(result.counts.analyses).toBe(0);
  });
  it.each(["-1", "481", "Infinity", "1.5", "", "--inventory"])("rejects an invalid or excessive readiness wait: %s", (value) => {
    expect(run({ args: ["--wait-seconds", value] }).status).not.toBe(0);
  });
});


it("keeps hosted inventories strict, bounded and pinned to the checkout SHA", () => {
  for (const file of ["security-alerts.yml", "codeql.yml"]) {
    const source = readFileSync(path.join(process.cwd(), ".github/workflows", file), "utf8");
    const commands = source.split("\n").filter((line) => line.includes("node scripts/security-alerts.mjs"));
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(command).toContain('--commit "$GITHUB_SHA"');
      expect(command).toMatch(/--wait-seconds (60|360)$/);
      expect(command).not.toContain("|| true");
    }
    expect(source).not.toContain("continue-on-error: true");
    if (file === "security-alerts.yml") {
      // This file is the gate: it must fail when findings remain.
      expect(commands.every(command => !command.includes("--inventory"))).toBe(true);
      expect(commands.every(command => !command.includes("--tool"))).toBe(true);
      expect(source).toContain("${{ github.event_name }}-${{ github.event.workflow_run.name || 'direct' }}");
    } else {
      // CodeQL's analysis job only reports. It used to gate as well, which made a closed loop: one
      // open alert turned the analysis red, Scorecard then counted that commit as not SAST-checked,
      // and its SASTID alert stayed open, keeping this step red. The gate lives in one place.
      expect(commands.every(command => command.includes("--tool CodeQL"))).toBe(true);
      expect(commands.every(command => command.includes("--inventory"))).toBe(true);
    }
  }
});
