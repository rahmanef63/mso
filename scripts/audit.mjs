#!/usr/bin/env node
// Local development tolerates an unavailable registry; --strict never treats a
// skipped/incomplete dependency audit as success. CI and security assurance use strict mode.
import { spawnSync } from "node:child_process";

const FLOOR = new Set(["high", "critical"]);
const AUDIT_TIMEOUT_MS = 15_000;
const STRICT = process.argv.includes("--strict");
if (process.argv.slice(2).some((arg) => arg !== "--strict")) {
  console.error("usage: node scripts/audit.mjs [--strict]");
  process.exit(2);
}

// GHSA/CVE -> reason + acceptance date, only when no upstream fix exists.
const IGNORE = {};
function unavailable(reason) {
  console.error(`audit: ${reason}; ${STRICT ? "INCOMPLETE (strict gate failed)" : "SKIPPED (not a security pass)"}`);
  process.exit(STRICT ? 2 : 0);
}

// Old Bun resolves unknown commands as package scripts; avoid recursively invoking this audit.
const versionProbe = spawnSync("bun", ["--version"], { encoding: "utf8", timeout: 5000 });
const version = /^(\d+)\.(\d+)\.(\d+)/.exec((versionProbe.stdout ?? "").trim());
const nativeAudit = version && (Number(version[1]) > 1 || Number(version[1]) === 1
  && (Number(version[2]) > 2 || Number(version[2]) === 2 && Number(version[3]) >= 15));
if (versionProbe.status !== 0 || !nativeAudit) unavailable("Bun >=1.2.15 with the native audit command is required; update Bun first");

const res = spawnSync("bun", ["audit", "--json"], {
  encoding: "utf8", timeout: AUDIT_TIMEOUT_MS, killSignal: "SIGTERM",
});
const raw = (res.stdout ?? "").trim();
if (res.error?.code === "ETIMEDOUT") unavailable(`registry timed out after ${AUDIT_TIMEOUT_MS / 1000}s`);
if (res.error || res.signal) unavailable("audit process did not complete");
// Do not echo registry diagnostics: proxy URLs may carry credentials.
if (!raw) unavailable("registry unreachable or no audit output");

let report;
try { report = JSON.parse(raw); } catch { unavailable("invalid JSON response"); }
if (!report || typeof report !== "object" || Array.isArray(report)) unavailable("invalid report shape");
// Bun JSON mode reports every severity regardless of --audit-level/--ignore.
// Exit 1 with valid advisories is expected; unknown process failures are not.
if (res.status !== 0 && res.status !== 1) unavailable("unexpected audit exit status");
if (res.status !== 0 && Object.keys(report).length === 0) unavailable("failed audit returned an empty report");

const hits = [];
const severities = new Set(["info", "low", "moderate", "medium", "high", "critical"]);
for (const [pkg, advisories] of Object.entries(report)) {
  if (!Array.isArray(advisories)) unavailable("invalid advisory list");
  for (const advisory of advisories) {
    if (!advisory || typeof advisory !== "object"
      || typeof advisory.severity !== "string" || !severities.has(advisory.severity.toLowerCase())) {
      unavailable("invalid advisory severity");
    }
    if (!FLOOR.has(advisory.severity.toLowerCase())) continue;
    const ghsa = /(GHSA-[a-z0-9-]+)/i.exec(String(advisory.url ?? ""))?.[1];
    const ids = [ghsa, advisory.github_advisory_id, advisory.id, advisory.cve,
      ...(Array.isArray(advisory.cves) ? advisory.cves : [])].filter(Boolean).map(String);
    if (ids.some((id) => Object.hasOwn(IGNORE, id))) continue;
    // Print only bounded identifiers, never arbitrary registry text/URLs.
    hits.push({ pkg: pkg.replace(/[^a-zA-Z0-9@/_.-]/g, "").slice(0, 160),
      id: ghsa ?? "unidentified-advisory", severity: advisory.severity.toUpperCase() });
  }
}
if (hits.length === 0) {
  console.log(`audit: clean at high/critical.${STRICT ? " (strict)" : ""}`);
  process.exit(0);
}
console.error(`audit: ${hits.length} unignored high/critical advisories:`);
for (const hit of hits) console.error(`  ${hit.severity}  ${hit.pkg}  ${hit.id}`);
console.error("Upgrade the affected dependency; do not lower the severity floor.");
process.exit(1);
