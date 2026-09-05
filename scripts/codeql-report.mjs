#!/usr/bin/env node
// Exact CodeQL SARIF inventory. It never dismisses findings and never prints source
// snippets or raw diagnostic messages that could contain sensitive values. GitHub
// open-alert state is the enforcement boundary because it respects reviewed/dismissed
// findings while still failing newly open branch alerts.
import fs from "node:fs";
import path from "node:path";

const directory = process.argv[2];
if (!directory) throw new Error("usage: node scripts/codeql-report.mjs <SARIF directory>");
const files = fs.readdirSync(directory).filter((name) => name.endsWith(".sarif"));
if (!files.length) throw new Error("CodeQL produced no SARIF file");

function commandValue(value) {
  return String(value ?? "").replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/:/g, "%3A").replace(/,/g, "%2C");
}
function safeLocation(row) {
  const p = row?.locations?.[0]?.physicalLocation;
  const raw = typeof p?.artifactLocation?.uri === "string" ? p.artifactLocation.uri : ".github";
  const file = /^[A-Za-z0-9_./-]{1,500}$/.test(raw) && !raw.includes("..") ? raw : ".github";
  const line = Number.isSafeInteger(p?.region?.startLine) && p.region.startLine > 0 ? p.region.startLine : 1;
  return { file, line };
}

let count = 0;
for (const name of files) {
  const data = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
  if (!Array.isArray(data.runs) || !data.runs.length) throw new Error("Missing CodeQL run");
  for (const run of data.runs) {
    if (run.tool?.driver?.name !== "CodeQL" || !Array.isArray(run.results)) throw new Error("Unexpected SARIF tool/result shape");
    for (const row of run.results) {
      const rule = run.tool.driver.rules?.find((candidate) => candidate.id === row.ruleId);
      const ruleId = typeof row.ruleId === "string" ? row.ruleId.slice(0, 160) : "unknown-rule";
      const severity = String(rule?.properties?.["security-severity"] ?? rule?.properties?.severity ?? "unknown").slice(0, 40);
      const { file, line } = safeLocation(row);
      console.log(`CODEQL_FINDING ${JSON.stringify({ rule: ruleId, severity, location: { path: file, line } })}`);
      console.log(`::warning file=${commandValue(file)},line=${line},title=${commandValue(`CodeQL SARIF · ${ruleId}`)}::${commandValue(`${severity} result present; open-alert enforcement runs after upload`)}`);
      count++;
    }
  }
}
console.log(`CODEQL_RESULT_COUNT ${count}`);
console.log("SARIF inventory complete; actual open-alert enforcement runs after GitHub processes this upload.");
