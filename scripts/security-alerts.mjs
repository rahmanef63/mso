#!/usr/bin/env node
// GitHub's actual findings, not merely a completed analysis. Read-only API calls;
// structured stdout is retained by Actions, without downloading remote content to files.
const { GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;
const args = process.argv.slice(2);
let selectedRef;
let inventory = false;
let includeClosed = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--inventory") inventory = true;
  else if (args[i] === "--include-closed") includeClosed = true;
  else if (args[i] === "--ref" && args[i + 1]) selectedRef = args[++i];
  else throw new Error("usage: node scripts/security-alerts.mjs [--inventory] [--ref refs/heads/branch] [--include-closed]");
}
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
  const recent = await get(`/code-scanning/analyses?ref=${encodeURIComponent(ref)}&per_page=100`);
  if (!Array.isArray(recent.value) || !recent.value.length) throw new Error("No scan evidence for the selected branch");
  if (!recent.value.some((scan) => scan.tool?.name === "CodeQL" && scan.commit_sha === branch.commit.sha && !scan.error)) {
    throw new Error("CodeQL has not completed successfully for the current selected-branch commit");
  }
  const alerts = await pages(`/code-scanning/alerts?state=open&ref=${encodeURIComponent(ref)}`);
  const rows = [];
  for (const alert of alerts) {
    const row = descriptor(alert);
    const instances = await pages(`/code-scanning/alerts/${row.number}/instances?ref=${encodeURIComponent(ref)}`);
    rows.push({ ...row, instances: instances.map(({ ref, analysis_key, category, state, message, location, classifications }) =>
      ({ ref, analysis_key, category, state, message, location, classifications })) });
  }
  const closed = includeClosed ? (await pages(`/code-scanning/alerts?state=closed&ref=${encodeURIComponent(ref)}`)).map(descriptor) : [];
  // Detect a concurrent publication before reporting stale findings as current.
  const after = (await get(`/branches/${encodeURIComponent(branchName)}`)).value;
  if (after.commit.sha !== branch.commit.sha) throw new Error("Branch changed during security verification; retry");
  const report = { capturedAt: new Date().toISOString(), repository: GITHUB_REPOSITORY,
    ref, head: branch.commit.sha, openCount: rows.length, alerts: rows, closed,
    recentAnalyses: recent.value.map(({ id, commit_sha, ref, created_at, category, error, tool }) =>
      ({ id, commit_sha, ref, created_at, category, error, tool })), olderAnalysesOmitted: recent.more };
  console.log(`CODE_SCANNING_REF ${ref}`);
  console.log(`CODE_SCANNING_HEAD ${report.head}`);
  console.log(`CODE_SCANNING_OPEN ${rows.length}`);
  for (const alert of rows) { console.log(`ALERT ${JSON.stringify(alert)}`); emitAnnotation(alert); }
  for (const alert of closed) console.log(`CLOSED_ALERT ${JSON.stringify(alert)}`);
  console.log(`CODE_SCANNING_REPORT ${JSON.stringify(report)}`);
  console.log("No alert was dismissed or deleted by this read-only verification.");
  process.exitCode = rows.length && !inventory ? 1 : 0;
} catch (error) {
  console.error(`INCOMPLETE: ${error.message}`);
  process.exitCode = 2;
}
