// Time-boxed, GHSA-named exceptions. A match also requires the named lockfile
// graph; a new parent, a production dependency, or a newer version fails closed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const BRACES_DEV_LINT = {
  id: "GHSA-vfj7-8cjw-p6xm",
  cve: "CVE-2026-93687",
  pkg: "braces",
  version: "3.0.3",
  until: "2026-12-03T00:00:00Z",
  lockfile: "bun.lock",
  reason: "braces 3.0.3 is reachable only through the devDependency chain eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch in bun.lock. @next/eslint-plugin-next calls fast-glob only when ESLint settings.next.rootDir is set, and eslint.config.mjs does not set it. No MSO source imports braces or passes a pattern to it. npm still publishes 3.0.3 as the newest braces release. This exception expires at 2026-12-03T00:00:00Z and the root osv-scanner.toml applies only to bun.lock.",
};

const BRACES_PARENTS = ["micromatch", "fast-glob", "@next/eslint-plugin-next", "eslint-config-next"];

export function readRepoLock() {
  return readFileSync(fileURLToPath(new URL("../bun.lock", import.meta.url)), "utf8");
}

function parseLock(lockText) {
  return JSON.parse(lockText.replace(/,(\s*[}\]])/g, "$1"));
}

function depsOf(entry) {
  const meta = entry.find((part) => part && typeof part === "object" && !Array.isArray(part));
  return meta?.dependencies ?? {};
}

function parentsOf(packages, name) {
  return Object.entries(packages)
    .filter(([, entry]) => Object.hasOwn(depsOf(entry), name))
    .map(([key]) => key)
    .sort();
}

export function bracesDevLintAllows(pkg, ids, lockText, now = new Date()) {
  if (pkg !== BRACES_DEV_LINT.pkg || !ids.includes(BRACES_DEV_LINT.id)) return false;
  if (!(now < new Date(BRACES_DEV_LINT.until))) return false;
  let lock;
  try { lock = parseLock(lockText); } catch { return false; }
  const packages = lock?.packages;
  const workspace = lock?.workspaces?.[""];
  if (!packages || !workspace) return false;
  const specs = Object.values(packages)
    .map((entry) => entry?.[0])
    .filter((spec) => typeof spec === "string" && spec.startsWith("braces@"));
  if (specs.length !== 1 || specs[0] !== `braces@${BRACES_DEV_LINT.version}`) return false;
  const expected = ["braces", ...BRACES_PARENTS];
  for (let i = 0; i < BRACES_PARENTS.length; i += 1) {
    const parents = parentsOf(packages, expected[i]);
    if (parents.length !== 1 || parents[0] !== BRACES_PARENTS[i]) return false;
  }
  const dev = workspace.devDependencies ?? {};
  const prod = workspace.dependencies ?? {};
  return Object.hasOwn(dev, "eslint-config-next") && !Object.hasOwn(prod, "eslint-config-next")
    && !Object.hasOwn(prod, "braces");
}
