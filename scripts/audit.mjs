#!/usr/bin/env node
// Dependency audit gate — the tolerant, LOCAL half.
//
// Why this exists rather than just `bun audit --audit-level=high`:
//
//   1. `bun audit` fails CLOSED. With no network it prints "audit request failed" and
//      exits 1 — the SAME exit code as a real advisory. Wired straight into a pre-push
//      hook that turns every flaky-DNS moment into a fake security failure that blocks
//      the push. Exit code alone cannot tell the two apart; empty stdout is the only
//      discriminator (`{}` when clean, nothing at all when the request died).
//   2. The ignore list belongs in version control. `--ignore=<id>` works, but a flag
//      buried in a script or a CI file has no room for WHY or WHEN, and nobody reviews
//      it. Here each entry carries a reason and a date and shows up in `git blame`.
//
// CI does NOT use this script — .github/workflows/ci.yml runs the raw fail-closed
// command on purpose, because a release gate must never pass an audit it could not
// actually perform.
//
// TRAP, learned the hard way: `--json` IGNORES both `--audit-level` and `--ignore`
// (it dumps the raw registry response and exits 1 on any advisory at any severity).
// So this script does its own severity + ignore filtering and never trusts bun's exit
// code in --json mode.

import { spawnSync } from "node:child_process";

const FLOOR = new Set(["high", "critical"]);
const AUDIT_TIMEOUT_MS = 15_000;

// GHSA/CVE id -> why it is accepted + the date it was accepted.
// Only for advisories with NO upstream fix. If a fix exists, take the fix (an
// `overrides` entry in package.json counts) instead of adding an entry here.
const IGNORE = {
  // e.g. "GHSA-xxxx-xxxx-xxxx": "no fixed release upstream; not reachable because <…>. Accepted 2026-08-03, recheck monthly.",
};

const res = spawnSync("bun", ["audit", "--json"], { encoding: "utf8", timeout: AUDIT_TIMEOUT_MS, killSignal: "SIGTERM" });
const raw = (res.stdout ?? "").trim();

if (res.error?.code === "ETIMEDOUT") {
  console.warn(`audit: registry timed out after ${AUDIT_TIMEOUT_MS / 1000}s, skipped`);
  process.exit(0);
}

// Empty stdout = the request never completed (offline, dead registry, proxy refused).
// Warn and pass: a broken network is not evidence of a vulnerability, and this is the
// local gate. CI is the one that fails closed.
if (!raw) {
  const why = (res.stderr ?? "").trim().split("\n").pop() || "no output";
  console.warn(`audit: registry unreachable, skipped — ${why}`);
  process.exit(0);
}

let report;
try {
  report = JSON.parse(raw);
} catch {
  console.warn("audit: could not parse `bun audit --json` output, skipped");
  process.exit(0);
}

// Shape: { "<pkg>": [ { id, severity, title, url, … } ], … }
const hits = [];
for (const [pkg, advisories] of Object.entries(report)) {
  for (const a of advisories ?? []) {
    if (!FLOOR.has(String(a.severity).toLowerCase())) continue;
    // bun's JSON carries only an opaque numeric `id`; the readable GHSA lives in the
    // advisory URL. Pull it out so IGNORE can be keyed on something a human recognises
    // and can look up, rather than on a bare number.
    const ghsa = /(GHSA-[a-z0-9-]+)/i.exec(a.url ?? "")?.[1];
    const ids = [ghsa, a.github_advisory_id, a.id, a.cve, ...(a.cves ?? [])].filter(Boolean).map(String);
    if (ids.some((id) => id in IGNORE)) continue;
    hits.push({ pkg, id: ghsa ?? String(a.id ?? "?"), severity: a.severity, title: a.title ?? "", url: a.url ?? "" });
  }
}

if (hits.length === 0) {
  console.log("audit: clean at high/critical.");
  process.exit(0);
}

console.error(`audit: ${hits.length} unignored high/critical advisor${hits.length === 1 ? "y" : "ies"}:`);
for (const h of hits) {
  console.error(`  ${h.severity.toUpperCase()}  ${h.pkg}  ${h.id}`);
  if (h.title) console.error(`      ${h.title}`);
  if (h.url) console.error(`      ${h.url}`);
}
console.error("");
console.error("Fix it (prefer an `overrides` entry in package.json pinning the patched version).");
console.error("If there is genuinely no upstream fix, add the id to IGNORE in scripts/audit.mjs");
console.error("with a reason and a date — do NOT lower the severity floor, that disables the whole tier.");
process.exit(1);
