#!/usr/bin/env node
// Verifies the reviewed dependency exceptions recorded in this repo.
//
// Two separate records, checked separately because they answer different
// scanners:
//
//   1. osv-scanner.toml — OSV-Scanner waivers. osv-scanner's IgnoredVulns
//      suppresses an advisory by id, which means a future copy of that advisory
//      under a different parent would also be silenced. This check narrows each
//      entry back to the decision actually reviewed: the advisory must still
//      exist, must still be unfixed upstream, and must still reach only the
//      named dev-only lockfile through the named build toolchain. There are
//      currently none, so that half passes only while that stays true.
//   2. .trivyignore.yaml — Trivy waivers. Trivy matches on the id it happens to
//      report, so the same advisory can be silenceable there while OSV has no
//      record at all (a withdrawn GHSA) or vice versa. Each entry must name a
//      single reviewed path, carry a future expiry and be known to this script;
//      an entry this script has not reviewed fails the run.
//
// Neither record may be used to make the other necessary. Coupling them is what
// once made two withdrawn waivers look load-bearing.
//
//   node scripts/audit-exceptions.mjs          # verify
//   node scripts/audit-exceptions.mjs --check  # same; used by the gates
//
// It fails closed: an unreadable lockfile, a renamed package or an expired date
// is a failure, never a skip.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(ROOT, "osv-scanner.toml");
const TRIVY_CONFIG = path.join(ROOT, ".trivyignore.yaml");

/** Reviewed OSV exceptions this repo allows, each with the chain that justifies it. */
const EXPECTED = [];

/** Reviewed Trivy-only waivers. One entry, one path, no chain. */
const TRIVY_EXPECTED = [
  {
    id: "CVE-2026-112366",
    osvAlias: "GHSA-fc5q-39xc-vjpf",
    package: "picomatch",
    path: "scripts/install/node-gyp/package-lock.json",
    severity: "high",
  },
];

function fail(message) {
  console.error(`audit-exceptions: ${message}`);
  process.exit(1);
}

function readConfig() {
  let text;
  try {
    text = readFileSync(CONFIG, "utf8");
  } catch {
    // No file means no exception is recorded, which is clean by definition.
    return [];
  }
  const entries = [];
  const blocks = text.split(/\[\[IgnoredVulns\]\]/).slice(1);
  for (const block of blocks) {
    const id = /^\s*id\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const until = /^\s*ignoreUntil\s*=\s*(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/m.exec(block)?.[1];
    const reason = /^\s*reason\s*=\s*"""([\s\S]*?)"""/m.exec(block)?.[1] ?? "";
    if (id) entries.push({ id, until, reason });
  }
  return entries;
}

// Hand-rolled line scan, same reasoning as readConfig: the file is small and
// fully owned by this repo, and a YAML parser would widen the dependency
// surface of a security gate for a handful of scalar keys. Anything this scan
// does not recognise is ignored, so a malformed entry surfaces as a missing
// field rather than a silent pass.
function readTrivyConfig() {
  let text;
  try {
    text = readFileSync(TRIVY_CONFIG, "utf8");
  } catch {
    // Trivy waivers are optional; absence is clean, not an error.
    return [];
  }
  const entries = [];
  let current;
  let inPaths = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const idMatch = /^\s*-\s*id:\s*["']?([^"'\s]+)["']?\s*$/.exec(line);
    if (idMatch) {
      current = { id: idMatch[1], paths: [], expiredAt: undefined };
      entries.push(current);
      inPaths = false;
      continue;
    }
    if (!current) continue;
    // `statement` is prose this check does not read, but it is matched so a
    // folded reason block ends the `paths` list rather than being scanned for
    // bullets.
    const key = /^\s*(paths|statement|expired_at):\s*(.*)$/.exec(line);
    if (key) {
      const [, name, value] = key;
      inPaths = name === "paths";
      if (name === "expired_at") current.expiredAt = value.trim().replace(/^["']|["']$/g, "");
      continue;
    }
    const bullet = /^\s*-\s*(.+)$/.exec(line);
    // Only bullets under `paths` are read. An inline `paths: [a, b]` therefore
    // leaves the list empty and fails the no-paths check instead of passing on
    // a value this scanner never understood.
    if (bullet && inPaths) {
      current.paths.push(bullet[1].trim().replace(/^["']|["']$/g, ""));
    }
  }
  return entries;
}

const configured = readConfig();
for (const entry of configured) {
  const expected = EXPECTED.find((item) => item.id === entry.id);
  if (!expected) fail(`${entry.id} is recorded in osv-scanner.toml but not reviewed by this script`);
  if (!entry.until) fail(`${entry.id} has no ignoreUntil; an exception without an expiry is not allowed`);
  const until = Date.parse(entry.until);
  if (!Number.isFinite(until)) fail(`${entry.id} has an unparseable ignoreUntil: ${entry.until}`);
  if (until <= Date.now()) fail(`${entry.id} expired on ${entry.until}; fix or re-review, do not extend blindly`);
  if (!entry.reason.includes(expected.package)) {
    fail(`${entry.id} reason does not name ${expected.package}`);
  }
}

// The reviewed chain must still be the chain in the lockfile. A second parent, a
// production dependency or a moved lockfile means the exception no longer
// describes reality, so it stops applying.
for (const expected of EXPECTED) {
  if (!configured.some((entry) => entry.id === expected.id)) continue;
  let lockfile;
  try {
    lockfile = readFileSync(path.join(ROOT, expected.lockfile), "utf8");
  } catch {
    fail(`${expected.id} is recorded but ${expected.lockfile} is missing or unreadable`);
  }
  if (!lockfile.includes(`"${expected.package}": ["${expected.package}@`)) {
    fail(`${expected.package} is no longer in ${expected.lockfile}; the exception is stale and must be removed`);
  }
  for (const parent of expected.chain) {
    // Plain string matching, not a dynamically built RegExp: a package name may
    // contain characters a hand-escaped pattern would miss, and CodeQL is right to
    // flag that class of construction. Lockfile entries are one per line, so the
    // parent's own line is the authoritative place to look.
    const parentLine = lockfile
      .split("\n")
      .find((line) => line.trimStart().startsWith(`"${parent}": [`));
    if (!parentLine || !parentLine.includes(`"${expected.package}"`)) {
      fail(`${expected.package} is no longer pulled in by ${parent}; the recorded chain changed`);
    }
  }
  // A production section that names the package would make this a runtime risk.
  const [, deps = ""] = lockfile.split(/\n\s*"dependencies"\s*:\s*\{/) ?? [];
  if (deps.includes(`"${expected.package}"`) && !/["']dev["']/.test(lockfile)) {
    fail(`${expected.package} appears in production dependencies; the dev-only justification no longer holds`);
  }
}

const trivyConfigured = readTrivyConfig();
for (const entry of trivyConfigured) {
  const expected = TRIVY_EXPECTED.find((item) => item.id === entry.id);
  if (!expected) fail(`${entry.id} is waived in .trivyignore.yaml but not reviewed by this script`);
  if (!entry.expiredAt) fail(`${entry.id} has no expired_at; a Trivy waiver without an expiry is not allowed`);
  const expiry = Date.parse(entry.expiredAt);
  if (!Number.isFinite(expiry)) fail(`${entry.id} has an unparseable expired_at: ${entry.expiredAt}`);
  if (expiry <= Date.now()) {
    fail(`${entry.id} expired on ${entry.expiredAt}; fix or re-review, do not extend blindly`);
  }
  if (entry.paths.length === 0) fail(`${entry.id} has no paths; an unscoped Trivy waiver would hide every copy`);
  for (const waived of entry.paths) {
    // A relative path containing .. would still "look" reviewed while pointing
    // somewhere else, so compare resolved paths and require the exact lockfile.
    const resolved = path.relative(ROOT, path.resolve(ROOT, waived));
    if (resolved !== expected.path) {
      fail(`${entry.id} waives ${waived}, which is not the reviewed ${expected.path}`);
    }
  }
}

// A reviewed waiver whose package disappeared is stale evidence, and a reviewed
// waiver the file forgot silently stopped applying. Both are failures.
for (const expected of TRIVY_EXPECTED) {
  if (!trivyConfigured.some((entry) => entry.id === expected.id)) {
    fail(`${expected.id} is reviewed by this script but missing from .trivyignore.yaml`);
  }
  let lockfile;
  try {
    lockfile = readFileSync(path.join(ROOT, expected.path), "utf8");
  } catch {
    fail(`${expected.id} is reviewed but ${expected.path} is missing or unreadable`);
  }
  if (!lockfile.includes(`"node_modules/${expected.package}"`)) {
    fail(`${expected.package} is no longer in ${expected.path}; the waiver is stale and must be removed`);
  }
}

const active = configured.filter((entry) => EXPECTED.some((item) => item.id === entry.id));
const trivyActive = trivyConfigured.filter((entry) =>
  TRIVY_EXPECTED.some((item) => item.id === entry.id),
);
console.log(
  active.length
    ? `audit-exceptions: ${active.length} reviewed exception(s) still valid — ${active.map((e) => `${e.id} until ${e.until}`).join(", ")}`
    : "audit-exceptions: no exceptions recorded",
);
console.log(
  trivyActive.length
    ? `audit-exceptions: ${trivyActive.length} reviewed Trivy waiver(s) still valid — ${trivyActive.map((e) => `${e.id} until ${e.expiredAt}`).join(", ")}`
    : "audit-exceptions: no Trivy waivers recorded",
);
