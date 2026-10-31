import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// The stale-build guard exists because `.next` is never built in place here (an in-place
// build takes the live :4005 service down), so the gate reads whatever was built last —
// usually a different commit. A tightened budget then fails against bytes that describe
// history, and the failure reads like a regression. Two things must hold: a stale build
// says so explicitly, and an authoritative build is not second-guessed.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A repo-shaped dir holding a copy of check-bundle.mjs plus a fake `.next`. */
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "mso-stale-bundle-"));
  roots.push(root);
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  mkdirSync(path.join(root, ".next"), { recursive: true });
  writeFileSync(path.join(root, ".next/BUILD_ID"), "fixture");
  // Budget 0 forces a violation whatever the measured bytes are; the point under test is
  // which MESSAGE comes out, not the numbers.
  writeFileSync(
    path.join(root, "scripts/bundle-budget.json"),
    JSON.stringify({ gzipBytes: { initial: 0, entry: 0, css: 0 }, preloadedFontBytes: 0 }, null, 2),
  );
  writeFileSync(
    path.join(root, "scripts/lib-bundle-report-stub.mjs"),
    `export function readBundleReport() {
  return { initial: { gzip: 10 }, entry: { gzip: 10 }, css: { gzip: 10, bytes: 0, files: 0 },
    fonts: { bytes: 0, files: 0 }, initialHeavyModules: [] };
}
export function bundleViolations() { return ['entry: 10 gzip bytes > 0']; }`,
  );
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  return root;
}

const SCRIPT = new URL("./check-bundle.mjs", import.meta.url).pathname;

function run(root: string, env: Record<string, string> = {}) {
  // Point the script's imports at the stub by running a rewritten copy.
  const source = readFileSync(SCRIPT, "utf8").replace("./lib/bundle-report.mjs", "./lib-bundle-report-stub.mjs");
  writeFileSync(path.join(root, "scripts/check-bundle-copy.mjs"), source);
  return spawnSync(process.execPath, ["scripts/check-bundle-copy.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("check-bundle stale-build guard", () => {
  it("names a stale build instead of reporting a bare regression", () => {
    const root = fixture();
    const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
    git("init", "-q");
    git("-c", "user.name=T", "-c", "user.email=t@example.invalid", "add", "scripts");
    git("-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "x");

    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("entry: 10 gzip bytes > 0");
    // The message must explain itself; a bare violation is the failure mode this guards.
    expect(result.stderr).toMatch(/stale|newer than the build|uncommitted/);
  });

  it("does not second-guess a build that is authoritative by declaration", () => {
    const root = fixture();
    const result = run(root, { MSO_BUNDLE_BUILD_IS_CURRENT: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("entry: 10 gzip bytes > 0");
    expect(result.stderr).not.toMatch(/stale|newer than the build|uncommitted/);
  });
});
