#!/usr/bin/env node
// GitHub's actual findings, not merely a completed analysis. Read-only API calls;
// structured stdout is retained by Actions, without downloading remote content to files.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;
// Reviewed OSV exceptions, parsed from the same osv-scanner.toml that
// scripts/audit-exceptions.mjs verifies. Missing or unreadable is not this
// script's failure: audit-exceptions.mjs owns recording correctness.
const CONFIG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(CONFIG_ROOT, "osv-scanner.toml");
function activeReviewedExceptions() {
  let text;
  try {
    text = readFileSync(CONFIG, "utf8");
  } catch {
    return [];
  }
  const active = [];
  for (const block of text.split(/\[\[IgnoredVulns\]\]/).slice(1)) {
    const id = /^\s*id\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const until = /^\s*ignoreUntil\s*=\s*(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/m.exec(block)?.[1];
    if (!id || !until) continue;
    const expires = Date.parse(until);
    if (Number.isFinite(expires) && expires > Date.now()) active.push({ id, until });
  }
  return active;
}
const reviewedExceptions = activeReviewedExceptions();
// A reviewed advisory only silences the Scorecard alert that names it. CodeQL
// findings and unknown tools stay open. Plain substring search, not a built
// RegExp: advisory ids are literal text and CodeQL flags hand-built patterns.
function reviewedException(alert) {
  if (alert.tool !== "Scorecard") return null;
  for (const instance of alert.instances ?? []) {
    const message = typeof instance.message === "string" ? instance.message : instance.message?.text ?? "";
    for (const entry of reviewedExceptions) if (message.includes(entry.id)) return entry;
  }
  return null;
}
const args = process.argv.slice(2);
let selectedRef;
let inventory = false;
let includeClosed = false;
let expectedCommit;
let waitSeconds = 0;
let selectedTool;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--inventory") inventory = true;
  else if (args[i] === "--include-closed") includeClosed = true;
  else if (args[i] === "--ref" && args[i + 1]) selectedRef = args[++i];
  else if (args[i] === "--commit" && args[i + 1]) expectedCommit = args[++i];
  else if (args[i] === "--tool" && args[i + 1] === "CodeQL") selectedTool = args[++i];
  else if (args[i] === "--wait-seconds" && /^(0|[1-9][0-9]{0,2})$/.test(args[i + 1] ?? "")) waitSeconds = Number(args[++i]);
  else throw new Error("usage: node scripts/security-alerts.mjs [--inventory] [--ref refs/heads/branch] [--include-closed] [--commit SHA] [--tool CodeQL] [--wait-seconds 0..480]");
}
if (waitSeconds > 480) throw new Error("Readiness wait must be bounded to 480 seconds");
if (expectedCommit && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(expectedCommit)) throw new Error("An exact commit SHA is required");
if (selectedRef && (!/^refs\/heads\/[A-Za-z0-9_./-]+$/.test(selectedRef) || selectedRef.includes("..") || selectedRef.endsWith("/"))) {
  throw new Error("An exact branch ref is required");
}
if (!GITHUB_TOKEN || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(GITHUB_REPOSITORY ?? "")) {
  throw new Error("A repository-scoped GitHub token and repository identifier are required");
}
const root = `https://api.github.com/repos/${GITHUB_REPOSITORY}`;
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
function descriptor(alert) {
  if (!Number.isSafeInteger(alert.number)) throw new Error("Invalid GitHub alert number");
  return { number: alert.number, state: alert.state, tool: alert.tool?.name,
    rule: { id: alert.rule?.id, severity: alert.rule?.severity, security_severity_level: alert.rule?.security_severity_level, description: alert.rule?.description },
    html_url: alert.html_url, created_at: alert.created_at,
    dismissed_reason: alert.dismissed_reason, dismissed_comment: alert.dismissed_comment,
    location: alert.most_recent_instance?.location };
}
function commandValue(value) {
  return String(value ?? "").replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/:/g, "%3A").replace(/,/g, "%2C");
}
function emitAnnotation(alert) {
  // Make the actual open finding visible through the public check-run annotation API.
  // Only rule/path/line/number are emitted; no snippets, secret values, or dismissal text.
  const location = alert.instances?.[0]?.location ?? alert.location ?? {};
  const rawPath = typeof location.path === "string" ? location.path : ".github";
  const safePath = /^[A-Za-z0-9_./-]{1,500}$/.test(rawPath) && !rawPath.includes("..") ? rawPath : ".github";
  const line = Number.isSafeInteger(location.start_line) && location.start_line > 0 ? location.start_line : 1;
  const rule = typeof alert.rule?.id === "string" ? alert.rule.id.slice(0, 160) : "unknown-rule";
  const severity = alert.rule?.security_severity_level ?? alert.rule?.severity ?? "unknown";
  console.log(`::warning file=${commandValue(safePath)},line=${line},title=${commandValue(`Code scanning #${alert.number} · ${rule}`)}::${commandValue(`${severity} finding remains open`)}`);
}
try {
  const repository = (await get("")).value;
  const ref = selectedRef ?? `refs/heads/${repository.default_branch}`;
  const branchName = ref.slice("refs/heads/".length);
  const branch = (await get(`/branches/${encodeURIComponent(branchName)}`)).value;
  if (expectedCommit && expectedCommit !== branch.commit.sha) throw new Error("Selected branch no longer matches the requested commit");
  const deadline = Date.now() + waitSeconds * 1000;
  let recent;
  for (;;) {
    recent = await get(`/code-scanning/analyses?ref=${encodeURIComponent(ref)}&per_page=100`);
    if (!Array.isArray(recent.value)) throw new Error("Invalid GitHub analysis response");
    const exact = recent.value.filter((scan) => scan.tool?.name === "CodeQL" && scan.commit_sha === branch.commit.sha && scan.ref === ref);
    if (exact.some((scan) => !scan.error)) break;
    if (exact.some((scan) => scan.error)) throw new Error("CodeQL analysis failed for the selected commit");
    if (Date.now() >= deadline) throw new Error("CodeQL has not completed successfully for the current selected-branch commit");
    const current = (await get(`/branches/${encodeURIComponent(branchName)}`)).value;
    if (current.commit.sha !== branch.commit.sha) throw new Error("Branch changed while waiting for CodeQL; retry");
    console.log(`WAITING_FOR_CODEQL ${ref} ${branch.commit.sha}`);
    // A push and a fast Scorecard run can precede CodeQL SARIF processing.
    // Only missing/stale analysis is retryable; API denial and real findings still fail.
    await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, deadline - Date.now())));
  }
  const toolQuery = selectedTool ? `&tool_name=${encodeURIComponent(selectedTool)}` : "";
  const alerts = await pages(`/code-scanning/alerts?state=open&ref=${encodeURIComponent(ref)}${toolQuery}`);
  const rows = [];
  const reviewed = [];
  for (const alert of alerts) {
    if (selectedTool && alert.tool?.name !== selectedTool) throw new Error("Unexpected tool in filtered security inventory");
    const row = descriptor(alert);
    const instances = await pages(`/code-scanning/alerts/${row.number}/instances?ref=${encodeURIComponent(ref)}`);
    const detail = { ...row, instances: instances.map(({ ref, analysis_key, category, state, message, location, classifications }) =>
      ({ ref, analysis_key, category, state, message, location, classifications })) };
    const exception = reviewedException(detail);
    if (exception) { reviewed.push({ number: row.number, ...exception }); continue; }
    rows.push(detail);
  }
  const closed = includeClosed ? (await pages(`/code-scanning/alerts?state=closed&ref=${encodeURIComponent(ref)}${toolQuery}`)).map(descriptor) : [];
  // Detect a concurrent publication before reporting stale findings as current.
  const after = (await get(`/branches/${encodeURIComponent(branchName)}`)).value;
  if (after.commit.sha !== branch.commit.sha) throw new Error("Branch changed during security verification; retry");
  const report = { capturedAt: new Date().toISOString(), repository: GITHUB_REPOSITORY,
    ref, head: branch.commit.sha, tool: selectedTool ?? "all", openCount: rows.length, alerts: rows, closed,
    recentAnalyses: recent.value.map(({ id, commit_sha, ref, created_at, category, error, tool }) =>
      ({ id, commit_sha, ref, created_at, category, error, tool })), olderAnalysesOmitted: recent.more };
  console.log(`CODE_SCANNING_REF ${ref}`);
  console.log(`CODE_SCANNING_HEAD ${report.head}`);
  console.log(`CODE_SCANNING_TOOL ${report.tool}`);
  console.log(`CODE_SCANNING_OPEN ${rows.length}`);
  for (const alert of reviewed) console.log(`REVIEWED_EXCEPTION ${alert.number} ${alert.id} ${alert.until}`);
  for (const alert of rows) { console.log(`ALERT ${JSON.stringify(alert)}`); emitAnnotation(alert); }
  for (const alert of closed) console.log(`CLOSED_ALERT ${JSON.stringify(alert)}`);
  console.log(`CODE_SCANNING_REPORT ${JSON.stringify(report)}`);
  console.log("No alert was dismissed or deleted by this read-only verification.");
  process.exitCode = rows.length && !inventory ? 1 : 0;
} catch (error) {
  console.error(`INCOMPLETE: ${error.message}`);
  process.exitCode = 2;
}
