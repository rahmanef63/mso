#!/usr/bin/env node
// Guard for the recorded OSV exceptions in osv-scanner.toml.
//
// osv-scanner's IgnoredVulns suppresses an advisory by id, which means a future
// copy of that advisory under a different parent would also be silenced. This
// check narrows it back to the decision actually reviewed: the advisory must
// still exist, must still be unfixed upstream, and must still reach only the one
// dev-only lockfile through the one build toolchain named in the reason.
//
// Trivy reports the same advisories under CVE ids and reads .trivyignore.yaml, so that
// file is verified against this same table: both records must agree on id, alias,
// expiry and path.
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
const TRIVY = path.join(ROOT, ".trivyignore.yaml");

/** Every exception this repo allows, with the chain that justifies it. */
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
  {
    // Only bun.lock is checked here. The same picomatch copy also sits in
    // scripts/install/node-gyp/package-lock.json, whose prod block is scanned
    // separately by `npm audit --prefix scripts/install/node-gyp --omit=dev`
    // in CI, so a second lockfile reader would add no coverage.
    id: "GHSA-fc5q-39xc-vjpf",
    // Trivy names the same advisory by CVE; both scanners must stay in step.
    aliases: ["CVE-2026-112366"],
    severity: "high",
    package: "picomatch",
    lockfile: "bun.lock",
    chain: ["tinyglobby"],
    dev: true,
  },
];

function fail(message) {
  console.error(`audit-exceptions: ${message}`);
  process.exit(1);
}

/**
 * bun.lock is JSON with trailing commas. Strip them and parse, so the dependency
 * edges come from the lockfile instead of a text search that cannot tell a
 * production edge from an unrelated mention. A parse failure fails closed.
 */
function lockGraph(text, label) {
  let json;
  try {
    json = JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    fail(`${label} is not parseable; no exception can be verified against it`);
  }
  const packages = json.packages ?? {};
  const edges = new Map();
  for (const [name, value] of Object.entries(packages)) {
    const meta = Array.isArray(value) ? value[2] ?? {} : {};
    // Peer and optional-peer entries do not install anything by themselves.
    edges.set(name, Object.keys(meta.dependencies ?? {}));
  }
  const roots = Object.values(json.workspaces ?? {}).flatMap((ws) => Object.keys(ws.dependencies ?? {}));
  const devRoots = Object.values(json.workspaces ?? {}).flatMap((ws) => Object.keys(ws.devDependencies ?? {}));
  return { edges, roots, devRoots };
}

/** Package names reachable from `roots`, following only installed dependencies. */
function reachable({ edges }, roots) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    queue.push(...(edges.get(name) ?? []));
  }
  return seen;
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
  // Workspace roots and every package's own dependency list are read from the
  // lockfile, so the closure is real rather than a text search: a prod package
  // that pulls this in transitively is caught too. Peer/optional-peer entries are
  // not edges because they do not install anything by themselves.
  const graph = lockGraph(lockfile, expected.lockfile);
  const prodReach = reachable(graph, graph.roots);
  if (prodReach.has(expected.package)) {
    fail(`${expected.package} is reachable from production dependencies; the dev-only justification no longer holds`);
  }
  if (expected.dev && !reachable(graph, graph.devRoots).has(expected.package)) {
    fail(`${expected.package} is no longer reachable from dev dependencies; the exception is stale and must be removed`);
  }
}

const active = configured.filter((entry) => EXPECTED.some((item) => item.id === entry.id));

// Trivy reports these under CVE ids and reads .trivyignore.yaml. Nothing else re-checks
// its expiry or path narrowing, so drift from the reviewed table above fails closed.
const NATIVE = path.join(ROOT, "scripts/install/node-gyp/package-lock.json");
const aliased = new Map(EXPECTED.flatMap((i) => [i.id, ...(i.aliases ?? [])].map((a) => [a, i])));
const strip = (v) => v.trim().replace(/^["']|["']$/g, "");

/** One flat list, read by hand: no YAML dependency, and a shape this cannot read fails. */
function readTrivy() {
  let text;
  try { text = readFileSync(TRIVY, "utf8"); } catch { return []; } // (d) catches the gap
  const head = /^vulnerabilities:[ \t]*$/m.exec(text);
  if (!head) fail(".trivyignore.yaml has no vulnerabilities: block; the record is unreadable");
  return text.slice(head.index + head[0].length).split(/^\s*-\s+id:\s*/m).slice(1).map((chunk) => {
    const block = `id: ${chunk}`;
    const id = /^\s*id:\s*(\S+)/m.exec(block)?.[1];
    const until = /^\s*expired_at:\s*(\S+)/m.exec(block)?.[1];
    // paths is an inline or block list; anything else reads as no paths at all.
    const after = block.split(/^[ \t]*paths:[ \t]*/m)[1] ?? "";
    const inline = after.startsWith("[") ? after.slice(0, after.indexOf("]") + 1) : "";
    const list = inline ? inline.replace(/^\[|\]$/g, "").split(",") : after.split("\n").filter((l) => /^\s*-\s+\S+\s*$/.test(l));
    const paths = list.map((v) => strip(v.replace(/^\s*-\s+/, ""))).filter(Boolean);
    if (!id) fail(".trivyignore.yaml has an entry with no id");
    if (!until) fail(`${id} has no expired_at; an exception without an expiry is not allowed`);
    if (!paths.length) fail(`${id} in .trivyignore.yaml has no paths; it would suppress every path`);
    return { id, until, paths };
  });
}

// (a) unknown id, (b) different expiry, (c) path outside the reviewed lockfile.
const trivy = readTrivy();
for (const entry of trivy) {
  const expected = aliased.get(entry.id);
  if (!expected) fail(`${entry.id} in .trivyignore.yaml has no matching reviewed entry in osv-scanner.toml`);
  const reviewed = configured.find((i) => i.id === expected.id);
  if (!reviewed) fail(`${entry.id} is ignored by Trivy but ${expected.id} is not recorded in osv-scanner.toml`);
  if (Date.parse(entry.until) !== Date.parse(reviewed.until)) fail(`${entry.id} expires ${entry.until} but ${expected.id} expires ${reviewed.until}; the two records must agree`);
  for (const value of entry.paths) if (path.resolve(ROOT, value) !== NATIVE) fail(`${entry.id} applies to ${value}, escaping ${path.relative(ROOT, NATIVE)}`);
}
// (d) A reviewed high/critical waiver needs its mirror, or one scanner silences it.
for (const entry of EXPECTED.filter((i) => i.severity === "high" || i.severity === "critical")) {
  if (!configured.some((c) => c.id === entry.id)) continue;
  if (!trivy.some((t) => [entry.id, ...(entry.aliases ?? [])].includes(t.id))) fail(`${entry.id} is waived for OSV but has no .trivyignore.yaml counterpart for the same chain`);
}

console.log(
  active.length
    ? `audit-exceptions: ${active.length} reviewed exception(s) still valid — ${active.map((e) => `${e.id} until ${e.until}`).join(", ")}`
    : "audit-exceptions: no exceptions recorded",
);
