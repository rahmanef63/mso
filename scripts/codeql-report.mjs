#!/usr/bin/env node
// Read-only evidence: report every SARIF result without filtering/deleting diagnostics.
import fs from "node:fs";
import path from "node:path";
const directory = process.argv[2];
if (!directory) throw new Error("usage: node scripts/codeql-report.mjs <SARIF directory>");
const files = fs.readdirSync(directory).filter((name) => name.endsWith(".sarif"));
if (!files.length) throw new Error("CodeQL produced no SARIF file");
let count = 0;
for (const name of files) {
  const data = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
  if (!Array.isArray(data.runs) || !data.runs.length) throw new Error("Missing CodeQL run");
  for (const run of data.runs) {
    if (run.tool?.driver?.name !== "CodeQL" || !Array.isArray(run.results)) throw new Error("Unexpected SARIF tool/result shape");
    for (const row of run.results) {
      const rule = run.tool.driver.rules?.find((rule) => rule.id === row.ruleId);
      const locations = (row.locations ?? []).map(({ physicalLocation: p }) => ({ path: p?.artifactLocation?.uri, line: p?.region?.startLine }));
      console.log(`CODEQL_FINDING ${JSON.stringify({ rule: row.ruleId, severity: rule?.properties?.["security-severity"], message: row.message?.text, locations })}`);
      count++;
    }
  }
}
console.log(`CODEQL_RESULT_COUNT ${count}`);
console.log("This is a diagnostic inventory, not a clearance decision; GitHub open-alert checks are separate.");
