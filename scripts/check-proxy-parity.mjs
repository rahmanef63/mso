#!/usr/bin/env node
// Parity guard for the two cockpit proxy allowlists.
//
// They must describe the same surface: the dev/preview proxy in
// frontend/svelte/tooling/backend-proxy.mjs and the Rust host policy table in
// rust-shell/crates/mso-shell-core/src/proxy.rs. They drifted once already, and the
// symptom was silent: a UI panel rendered but its data request 404'd, because both
// tables match exact paths and one table simply did not list the child route.
//
// The invariant is deliberately not "the two tables are identical". The Rust host is
// also the entry point for external protocol clients, so it additionally carries
// /mcp, /oauth/*, /a2a/v1 and /.well-known/* with forward_authorization, and the
// browser dev proxy has no reason to expose those. The cockpit surface is /api/*,
// and THAT must agree exactly on both sides.
//
// Checks, all of which must hold:
//   1. every /api/* path in either table exists in the other (both directions);
//   2. the method set matches for each shared path;
//   3. every exact (non-prefix) table path corresponds to a real app/**/route.ts
//      handler, so a stale entry cannot outlive its endpoint.
//
// Non-/api protocol paths present only in the Rust table are reported, not failed.
//
// Usage: node scripts/check-proxy-parity.mjs [--verbose]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEV_ALLOWLIST = join(ROOT, "frontend/svelte/tooling/backend-proxy.mjs");
const RUST_POLICIES = join(ROOT, "rust-shell/crates/mso-shell-core/src/proxy.rs");
const VERBOSE = process.argv.includes("--verbose");

/** App Router directory walk: every route.ts contributes its URL path. No "next" dependency. */
function appRoutePaths(dir = join(ROOT, "app"), base = "") {
  const found = new Set();
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Route groups like (marketing) do not contribute a URL segment.
      const segment = /^\(.*\)$/.test(entry) ? "" : `/${entry}`;
      for (const nested of appRoutePaths(full, base + segment)) found.add(nested);
    } else if (entry === "route.ts") {
      found.add(base === "" ? "/" : base);
    }
  }
  return found;
}

function parseDevAllowlist(source) {
  const table = new Map();
  const entry = /^\s*"(\/api[^"]*)"\s*:\s*\[([^\]]*)\]/gm;
  for (const match of source.matchAll(entry)) {
    const methods = [...match[2].matchAll(/"([A-Z]+)"/g)].map((m) => m[1]).sort();
    table.set(match[1], methods);
  }
  return table;
}

function parseRustPolicies(source) {
  const table = new Map();
  const entry = /RoutePolicy\s*\{\s*path:\s*"([^"]+)"[^}]*?prefix:\s*(true|false)[^}]*?methods:\s*&\[([^\]]*)\]/g;
  for (const match of source.matchAll(entry)) {
    const methods = [...match[3].matchAll(/"([A-Z]+)"/g)].map((m) => m[1]).sort();
    table.set(match[1], { methods, prefix: match[2] === "true" });
  }
  return table;
}

const dev = parseDevAllowlist(readFileSync(DEV_ALLOWLIST, "utf8"));
const rust = parseRustPolicies(readFileSync(RUST_POLICIES, "utf8"));
const appRoutes = appRoutePaths();

const isCockpitPath = (path) => path.startsWith("/api/");
const problems = [];
const rustOnlyProtocol = [];

for (const [path, methods] of dev) {
  if (!rust.has(path)) {
    problems.push(`missing from Rust policy table: ${path} (${methods.join(",")})`);
    continue;
  }
  const rustMethods = rust.get(path).methods;
  if (methods.join(",") !== rustMethods.join(",")) {
    problems.push(`method mismatch for ${path}: dev=[${methods}] rust=[${rustMethods}]`);
  }
}

for (const [path, policy] of rust) {
  if (dev.has(path)) continue;
  // Protocol surfaces reached only by external clients are Rust-only by design.
  if (!isCockpitPath(path)) { rustOnlyProtocol.push(path); continue; }
  problems.push(`missing from dev allowlist: ${path} (${policy.methods.join(",")})`);
}

for (const [path, policy] of rust) {
  if (policy.prefix) continue; // prefix routes match a family, not one handler path
  if (!appRoutes.has(path)) problems.push(`no app route handler exists for allowlisted path: ${path}`);
}

const shared = [...dev.keys()].filter((p) => rust.has(p));
console.log("proxy allowlist parity");
console.log(`  dev allowlist paths      ${String(dev.size).padStart(4)}`);
console.log(`  rust policy paths        ${String(rust.size).padStart(4)}`);
console.log(`  shared with matching set ${String(shared.length).padStart(4)}`);
console.log(`  rust-only protocol paths ${String(rustOnlyProtocol.length).padStart(4)}`);
console.log(`  app route handlers       ${String(appRoutes.size).padStart(4)}`);

if (VERBOSE) {
  const onlyDev = [...dev.keys()].filter((p) => !rust.has(p));
  if (onlyDev.length) console.log(`  only in dev:  ${onlyDev.join(", ")}`);
  if (rustOnlyProtocol.length) console.log(`  rust-only:    ${rustOnlyProtocol.join(", ")}`);
}

if (problems.length > 0) {
  console.error("");
  for (const problem of problems) console.error(`  FAIL ${problem}`);
  console.error("");
  console.error("proxy-parity: the two cockpit allowlists describe different surfaces.");
  console.error("Add or remove the entry in BOTH tables; never widen one alone.");
  process.exit(1);
}

console.log("proxy-parity: both allowlists describe the same surface.");
