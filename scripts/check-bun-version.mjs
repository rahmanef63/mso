#!/usr/bin/env node
// Dependency-free so the guard runs before any package installation.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
export const BUN_RUNTIME_RANGE = ">=1.4.2 <2";
// The pin is the lower bound of the advertised range, so the two cannot drift apart.
export const BUN_PIN = /^>=\s*(\d+\.\d+\.\d+)/.exec(BUN_RUNTIME_RANGE)?.[1];
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;
const COMPARATOR = /^(>=|<=|>|<|=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-[0-9A-Za-z.-]+)?$/;

function parse(version) {
  const match = typeof version === "string" ? SEMVER.exec(version) : null;
  return match ? match.slice(1, 4).map(Number) : null;
}

function compare(a, b) {
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  return 0;
}

export function supportedBunVersion(version) {
  const target = parse(version);
  if (!target) return false;
  const comparators = BUN_RUNTIME_RANGE.trim().split(/\s+/);
  return comparators.every((comparator) => {
    const match = COMPARATOR.exec(comparator);
    if (!match) return false;
    const operator = match[1] ?? "=";
    const bound = [match[2], match[3] ?? "0", match[4] ?? "0"].map(Number);
    const order = compare(target, bound);
    return operator === ">=" ? order >= 0
      : operator === ">" ? order > 0
      : operator === "<=" ? order <= 0
      : operator === "<" ? order < 0
      : order === 0;
  });
}

export function currentBunVersion() {
  return process.versions.bun || null;
}

// Node-driven entry points (verify, preflight) have no process.versions.bun,
// so the CLI resolves the ambient bun on PATH.
function detectBunOnPath() {
  try {
    return execFileSync("bun", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

// Prerelease suffixes compare by their numeric core, so a canary of the pin is accepted.
export function assertBunRuntime(version) {
  const found = arguments.length === 0 ? currentBunVersion() : version;
  if (!supportedBunVersion(found ?? "")) {
    throw new Error(`MSO requires bun ${BUN_RUNTIME_RANGE} (package.json pins bun@${BUN_PIN}); found ${found}. Older bun cannot read frontend/svelte/bun.lock (lockfileVersion 2) and will silently ignore it. Install the pinned bun before verifying.`);
  }
}

export function checkPackageManagerPin(pkg) {
  const packageManager = typeof pkg?.packageManager === "string" ? pkg.packageManager : "";
  const pin = /^bun@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(packageManager)?.[1];
  if (!pin) throw new Error(`package.json must pin the Bun runtime as "bun@<version>"; found "${packageManager || "(missing)"}".`);
  if (!supportedBunVersion(pin)) {
    throw new Error(`package.json pins bun@${pin}, which is outside the advertised engines.bun range ${BUN_RUNTIME_RANGE}. Bump the pin and the range together.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = currentBunVersion() ?? detectBunOnPath();
  try { assertBunRuntime(version); console.log(`bun ${version} is supported`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
