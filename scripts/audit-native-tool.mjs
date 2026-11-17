#!/usr/bin/env node
// Audit the isolated node-gyp bootstrap toolchain, honouring the reviewed waivers.
//
// This mirrors the waiver record in osv-scanner.toml so one reviewable list governs
// bun.lock and the isolated node-gyp bootstrap; the bootstrap lockfile is install-time
// tooling and never ships to the server.
//
//   node scripts/audit-native-tool.mjs
//
// It fails closed: an unparseable report, a killed/timed-out audit, a missing
// advisory shape, an expired waiver or a package that is not installed in the
// bootstrap lockfile is a failure, never a skip. Registry silence is not a pass.
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(ROOT, "osv-scanner.toml");
const LOCKFILE = path.join(ROOT, "scripts/install/node-gyp/package-lock.json");
const PREFIX = "scripts/install/node-gyp";
const TIMEOUT_MS = 120_000;
const BLOCKING = new Set(["high", "critical"]);

function fail(message) {
  console.error(`audit-native-tool: ${message}`);
  process.exit(1);
}

/** Same parsing rule as scripts/audit-exceptions.mjs: one waiver list, one reader shape. */
function readWaivers() {
  let text;
  try {
    text = readFileSync(CONFIG, "utf8");
  } catch {
    // No file means no waiver is recorded, so nothing can be tolerated.
    return new Map();
  }
  const waivers = new Map();
  for (const block of text.split(/\[\[IgnoredVulns\]\]/).slice(1)) {
    const id = /^\s*id\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const until = /^\s*ignoreUntil\s*=\s*(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/m.exec(block)?.[1];
    if (id) waivers.set(id.toUpperCase(), { id, until });
  }
  return waivers;
}

/** Installed package names from the bootstrap lockfile; a missing entry means no waiver applies. */
function installedPackages() {
  let lock;
  try {
    lock = JSON.parse(readFileSync(LOCKFILE, "utf8"));
  } catch {
    fail(`${PREFIX}/package-lock.json is unreadable; the toolchain under audit is unverifiable`);
  }
  const packages = lock?.packages;
  if (!packages || typeof packages !== "object") {
    fail(`${PREFIX}/package-lock.json has no packages block; the toolchain under audit is unverifiable`);
  }
  const names = new Set();
  for (const key of Object.keys(packages)) {
    const at = key.lastIndexOf("node_modules/");
    if (at !== -1) names.add(key.slice(at + "node_modules/".length));
  }
  return names;
}

function auditReport() {
  const result = spawnSync(
    "npm",
    ["audit", "--prefix", PREFIX, "--omit=dev", "--audit-level=high", "--json"],
    { cwd: ROOT, encoding: "utf8", timeout: TIMEOUT_MS, shell: false },
  );
  if (result.error) fail(`could not run npm audit: ${result.error.message}`);
  if (result.signal) fail(`npm audit was killed by ${result.signal}; a silent registry is not a pass`);
  const stdout = result.stdout ?? "";
  if (!stdout.trim()) fail(`npm audit produced no report (exit ${result.status}); registry silence is not a pass`);
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    fail(`npm audit report is not parseable JSON (exit ${result.status})`);
  }
  if (report?.error) fail(`npm audit reported an error: ${JSON.stringify(report.error.summary ?? report.error)}`);
  const vulnerabilities = report?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== "object") {
    fail("npm audit report has no vulnerabilities block; the advisory shape is unexpected");
  }
  return vulnerabilities;
}

const GHSA = /GHSA-[a-z0-9-]+/gi;

function collectAdvisories(vulnerabilities) {
  /** Advisories named directly by their own package entry. */
  const direct = new Map();
  /** Names each package rolls up, so a transitive severity entry keeps its real id. */
  const edges = new Map();
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    const severity = String(entry?.severity ?? "").toLowerCase();
    if (!BLOCKING.has(severity)) continue;
    if (!Array.isArray(entry?.via)) fail(`advisory for ${name} has no via list; the shape is unexpected`);
    const ids = new Set();
    const rollups = new Set();
    let advisoryObjects = 0;
    for (const via of entry.via) {
      if (typeof via === "string") {
        rollups.add(via);
        continue;
      }
      advisoryObjects += 1;
      if (!via?.url && !via?.name) {
        fail(`advisory for ${name} has neither url nor name; the shape is unexpected`);
      }
      for (const value of [via.url, via.name, via.title]) {
        if (typeof value !== "string") continue;
        for (const match of value.matchAll(GHSA)) ids.add(match[0].toUpperCase());
      }
    }
    // A rollup-only entry names its parents as strings; it holds no advisory object.
    if (advisoryObjects === 0 && !rollups.size) fail(`advisory for ${name} has an empty via list`);
    if (advisoryObjects > 0 && !ids.size) fail(`${name} is ${severity} but its advisory names no GHSA id`);
    edges.set(name, rollups);
    if (ids.size) direct.set(name, { severity, ids });
  }
  return { direct, edges };
}

function waiversFor({ direct, edges }) {
  const waivers = readWaivers();
  const tolerated = new Map();
  for (const [name, { severity, ids }] of direct) {
    const covered = new Set(ids);
    // A rollup-only entry (fdir, tinyglobby, node-gyp) inherits the id of the
    // package that carries the advisory object, so no real advisory is hidden.
    const queue = [...(edges.get(name) ?? [])];
    const seen = new Set();
    while (queue.length) {
      const parent = queue.pop();
      if (seen.has(parent)) continue;
      seen.add(parent);
      for (const id of direct.get(parent)?.ids ?? []) covered.add(id);
      queue.push(...(edges.get(parent) ?? []));
    }
    for (const id of covered) {
      const waiver = waivers.get(id);
      if (!waiver) fail(`${name} has unwaived ${severity} advisory ${id}; fix it or record a dated waiver in osv-scanner.toml`);
      if (!waiver.until) fail(`${id} has no ignoreUntil; a waiver without an expiry cannot suppress anything`);
      const until = Date.parse(waiver.until);
      if (!Number.isFinite(until)) fail(`${id} has an unparseable ignoreUntil: ${waiver.until}`);
      if (until <= Date.now()) fail(`${id} expired on ${waiver.until}; fix or re-review, do not extend blindly`);
      if (!tolerated.has(waiver.id)) tolerated.set(waiver.id, new Set());
      tolerated.get(waiver.id).add(name);
      for (const parent of seen) tolerated.get(waiver.id).add(parent);
    }
  }
  return tolerated;
}

/** The waived advisory must still describe a package installed by the isolated toolchain. */
function verifyToolchain(tolerated) {
  const installed = installedPackages();
  for (const [id, names] of tolerated) {
    for (const name of names) {
      if (!installed.has(name)) {
        fail(`${id} is waived for ${name}, which is not installed in ${PREFIX}/package-lock.json`);
      }
    }
  }
}

const tolerated = waiversFor(collectAdvisories(auditReport()));
verifyToolchain(tolerated);

const waived = [...tolerated.keys()].sort();
console.log(
  `audit-native-tool: ${PREFIX} clean at high/critical (waived: ${waived.length ? waived.join(", ") : "none"}).`,
);
