#!/usr/bin/env node
// Inspect GitHub's actual default-branch findings, not merely successful scan jobs.
// Uses only a repository-scoped Actions token; never emits tokens or secret-scan values.
import fs from "node:fs";
import path from "node:path";

const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_STEP_SUMMARY, RUNNER_TEMP } = process.env;
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--inventory")) throw new Error("usage: node scripts/security-alerts.mjs [--inventory]");
if (!GITHUB_TOKEN || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(GITHUB_REPOSITORY ?? "")) {
  throw new Error("A repository-scoped GitHub token and repository identifier are required");
}
const root = `https://api.github.com/repos/${GITHUB_REPOSITORY}`;
const directory = fs.mkdtempSync(path.join(RUNNER_TEMP || process.cwd(), "mso-code-scanning-"));
fs.chmodSync(directory, 0o700);
const safe = (value) => String(value ?? "").replace(/[\r\n|<>]/g, " ").slice(0, 500);
async function get(suffix) {
  const response = await fetch(root + suffix, { headers: {
    Accept: "application/vnd.github+json", Authorization: `Bearer ${GITHUB_TOKEN}`,
    "X-GitHub-Api-Version": "2022-11-28",
  }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GitHub security inventory unavailable (HTTP ${response.status})`);
  return { value: await response.json(), more: /rel="next"/.test(response.headers.get("link") ?? "") };
}
async function pages(suffix) {
  const all = [];
  for (let page = 1; page <= 100; page++) {
    const result = await get(`${suffix}${suffix.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    if (!Array.isArray(result.value)) throw new Error("Invalid GitHub list response");
    all.push(...result.value);
    if (!result.more) return all;
  }
  throw new Error("Pagination incomplete; no clean result may be claimed");
}
try {
  const repository = (await get("")).value;
  const branch = (await get(`/branches/${encodeURIComponent(repository.default_branch)}`)).value;
  const ref = `refs/heads/${repository.default_branch}`;
  const alerts = await pages(`/code-scanning/alerts?state=open&ref=${encodeURIComponent(ref)}`);
  const recent = await get(`/code-scanning/analyses?ref=${encodeURIComponent(ref)}&per_page=100`);
  if (!Array.isArray(recent.value) || !recent.value.length) throw new Error("No scan evidence for the default branch");
  if (!recent.value.some((scan) => scan.tool?.name === "CodeQL" && scan.commit_sha === branch.commit.sha && !scan.error)) {
    throw new Error("CodeQL has not completed successfully for the current default-branch commit");
  }
  const rows = [];
  for (const alert of alerts) {
    if (!Number.isSafeInteger(alert.number)) throw new Error("Invalid GitHub alert number");
    const instances = await pages(`/code-scanning/alerts/${alert.number}/instances?ref=${encodeURIComponent(ref)}`);
    rows.push({ number: alert.number, state: alert.state, tool: alert.tool?.name,
      rule: alert.rule, html_url: alert.html_url, created_at: alert.created_at,
      instances: instances.map(({ ref, analysis_key, category, state, message, location, classifications }) =>
        ({ ref, analysis_key, category, state, message, location, classifications })) });
  }
  const report = { capturedAt: new Date().toISOString(), repository: GITHUB_REPOSITORY,
    ref, head: branch.commit.sha, openCount: rows.length, alerts: rows,
    recentAnalyses: recent.value.map(({ id, commit_sha, ref, created_at, category, error, tool }) =>
      ({ id, commit_sha, ref, created_at, category, error, tool })),
    olderAnalysesOmitted: recent.more };
  fs.writeFileSync(path.join(directory, "code-scanning.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`CODE_SCANNING_HEAD ${report.head}`);
  console.log(`CODE_SCANNING_OPEN ${rows.length}`);
  for (const alert of rows) console.log(`ALERT ${JSON.stringify(alert)}`);
  const summary = ["## Default-branch code scanning", "", `Commit: \`${report.head}\` · **${rows.length} open findings**`, "",
    "Analysis completion is not alert clearance. No alert was dismissed or deleted by this read-only job.", "",
    "| Alert | Tool | Severity | Rule | Location |", "|---|---|---|---|---|",
    ...rows.map((alert) => `| ${alert.number} | ${safe(alert.tool)} | ${safe(alert.rule?.security_severity_level ?? alert.rule?.severity)} | ${safe(alert.rule?.id)} | ${safe(alert.instances[0]?.location?.path)}:${alert.instances[0]?.location?.start_line ?? ""} |`), ""].join("\n");
  if (GITHUB_STEP_SUMMARY) fs.appendFileSync(GITHUB_STEP_SUMMARY, summary);
  console.log(`REPORT_DIRECTORY ${directory}`);
  process.exitCode = rows.length && !args.includes("--inventory") ? 1 : 0;
} catch (error) {
  console.error(`INCOMPLETE: ${error.message}`);
  process.exitCode = 2;
}
