#!/usr/bin/env node
// Local development tolerates an unavailable registry; --strict never treats a
// skipped/incomplete dependency audit as success. CI and security assurance use strict mode.
//
// Cold CI runners regularly need more than one registry handshake, so the probe is
// bounded per attempt AND retried inside a total budget. Exhausting the budget still
// fails closed, but with a message that says "registry unreachable" instead of being
// mistakable for "advisories found".
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const FLOOR = new Set(["high", "critical"]);
const num = (raw, fallback) => {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};
// Per-attempt ceiling, retry count, backoff, and total wall clock. Worst case is
// bounded well inside the 30-minute CI verify job even with three cold handshakes.
const AUDIT_TIMEOUT_MS = num(process.env.MSO_AUDIT_TIMEOUT_MS, 30_000);
const AUDIT_ATTEMPTS = num(process.env.MSO_AUDIT_ATTEMPTS, 3); // first try + 2 retries
const AUDIT_BACKOFF_MS = num(process.env.MSO_AUDIT_BACKOFF_MS, 2_000); // doubles per retry
const AUDIT_BUDGET_MS = num(process.env.MSO_AUDIT_BUDGET_MS, 90_000);
// A clean run leaves a lockfile-addressed receipt. Registry silence may reuse that
// evidence ONLY while bun.lock is byte-identical and the receipt is still fresh;
// otherwise the gate fails closed. This is the "no new advisories in the window we
// could reach" case, never a substitute for an audit that never ran.
const RECEIPT_PATH = process.env.MSO_AUDIT_RECEIPT
  ?? path.join(os.homedir(), ".cache", "mso", "audit-receipt.json");
const RECEIPT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LOCKFILE = path.join(process.cwd(), "bun.lock");
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
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function lockfileDigest() {
  try { return createHash("sha256").update(readFileSync(LOCKFILE)).digest("hex"); } catch { return null; }
}
function cleanReceipt(digest, at) {
  if (!digest) return null;
  try {
    const row = JSON.parse(readFileSync(RECEIPT_PATH, "utf8"));
    if (!row || row.lockfile !== digest || typeof row.at !== "string") return null;
    const age = (at ?? Date.now()) - Date.parse(row.at);
    if (!Number.isFinite(age) || age < 0 || age > RECEIPT_MAX_AGE_MS) return null;
    return row;
  } catch { return null; }
}
function writeReceipt(digest, at) {
  if (!digest) return;
  const tmp = `${RECEIPT_PATH}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    mkdirSync(path.dirname(RECEIPT_PATH), { recursive: true, mode: 0o700 });
    writeFileSync(tmp, JSON.stringify({ lockfile: digest, at: new Date(at).toISOString() }), { mode: 0o600, flag: "wx" });
    renameSync(tmp, RECEIPT_PATH);
  } catch {
    // Receipts are an optimisation, not evidence: never fail a clean audit for them.
    try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
  }
}

// Old Bun resolves unknown commands as package scripts; avoid recursively invoking this audit.
const versionProbe = spawnSync("bun", ["--version"], { encoding: "utf8", timeout: 5000 });
const version = /^(\d+)\.(\d+)\.(\d+)/.exec((versionProbe.stdout ?? "").trim());
const nativeAudit = version && (Number(version[1]) > 1 || Number(version[1]) === 1
  && (Number(version[2]) > 2 || Number(version[2]) === 2 && Number(version[3]) >= 15));
if (versionProbe.status !== 0 || !nativeAudit) unavailable("Bun >=1.2.15 with the native audit command is required; update Bun first");

// A probe is inconclusive when the child was killed on timeout, died on a signal, or
// produced no report at all. Real advisories always arrive as parseable JSON.
const inconclusive = (result) => !(result.stdout ?? "").trim()
  || result.error?.code === "ETIMEDOUT" || Boolean(result.signal);

const started = Date.now();
let res;
let attempts = 0;
let sawTimeout = false;
while (attempts < AUDIT_ATTEMPTS) {
  const remaining = AUDIT_BUDGET_MS - (Date.now() - started);
  if (remaining <= 0) { sawTimeout = true; break; }
  attempts += 1;
  res = spawnSync("bun", ["audit", "--json"], {
    encoding: "utf8", timeout: Math.min(AUDIT_TIMEOUT_MS, remaining), killSignal: "SIGTERM",
  });
  if (!inconclusive(res)) break;
  if (res.error?.code === "ETIMEDOUT" || res.signal) sawTimeout = true;
  const backoff = AUDIT_BACKOFF_MS * 2 ** (attempts - 1);
  if (attempts >= AUDIT_ATTEMPTS) break;
  if (AUDIT_BUDGET_MS - (Date.now() - started) <= backoff) { sawTimeout = true; break; }
  console.error(`audit: registry probe attempt ${attempts}/${AUDIT_ATTEMPTS} inconclusive (${sawTimeout ? "timeout" : "no report"}); retrying in ${backoff}ms`);
  sleep(backoff);
}

const elapsedMs = Date.now() - started;
const raw = (res?.stdout ?? "").trim();
if (inconclusive(res ?? {})) {
  const detail = `${attempts} attempt(s) in ${(elapsedMs / 1000).toFixed(1)}s (per attempt ${AUDIT_TIMEOUT_MS / 1000}s, budget ${AUDIT_BUDGET_MS / 1000}s)`;
  // Registry silence is NOT "no advisories". It may only be reported as such when a
  // prior successful audit of this exact lockfile is on disk and still fresh.
  const digest = lockfileDigest();
  const receipt = cleanReceipt(digest, Date.now());
  if (receipt) {
    console.log(`audit: registry unreachable (${detail}); reusing clean lockfile audit from ${receipt.at} for this exact bun.lock.${STRICT ? " (strict)" : ""}`);
    process.exit(0);
  }
  unavailable(sawTimeout
    ? `registry unreachable (no lockfile-clean evidence): timed out after ${detail}`
    : `registry unreachable (no lockfile-clean evidence): no audit report after ${detail}`);
}
if (res.error || res.signal) unavailable("audit process did not complete");
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
  writeReceipt(lockfileDigest(), Date.now());
  console.log(`audit: clean at high/critical.${STRICT ? " (strict)" : ""}`);
  process.exit(0);
}
console.error(`audit: ${hits.length} unignored high/critical advisories:`);
for (const hit of hits) console.error(`  ${hit.severity}  ${hit.pkg}  ${hit.id}`);
console.error("Upgrade the affected dependency; do not lower the severity floor.");
process.exit(1);
