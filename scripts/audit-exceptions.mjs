#!/usr/bin/env node
// Guard for the single recorded OSV exception in osv-scanner.toml.
//
// osv-scanner's IgnoredVulns suppresses an advisory by id, which means a future
// copy of that advisory under a different parent would also be silenced. This
// check narrows it back to the decision actually reviewed: the advisory must
// still exist, must still be unfixed upstream, and must still reach only the one
// dev-only lockfile through the one build toolchain named in the reason.
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

/** The one exception this repo allows, with the chain that justifies it. */
const EXPECTED = [
  {
    id: "GHSA-gcqx-w48m-w2h4",
    package: "deepmerge",
    lockfile: "frontend/svelte/bun.lock",
    // Every parent must be one of these, and each must be a dev-only tool.
    // A production dependency appearing here is a defect, not a wider exception.
    chain: ["@sveltejs/vite-plugin-svelte"],
    dev: true,
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

const active = configured.filter((entry) => EXPECTED.some((item) => item.id === entry.id));
console.log(
  active.length
    ? `audit-exceptions: ${active.length} reviewed exception(s) still valid — ${active.map((e) => `${e.id} until ${e.until}`).join(", ")}`
    : "audit-exceptions: no exceptions recorded",
);
