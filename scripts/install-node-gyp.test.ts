import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const SOURCE = path.join(process.cwd(), "scripts/install/node-gyp");
const VERSION = JSON.parse(fs.readFileSync(path.join(SOURCE, "package.json"), "utf8")).dependencies["node-gyp"] as string;
const HELPER = path.join(process.cwd(), "scripts/install/node-gyp.sh");
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-node-gyp-pin-")); roots.push(root);
  const repo = path.join(root, "repo"), bin = path.join(root, "bin"), cache = path.join(root, "custom-cache");
  fs.mkdirSync(bin); fs.mkdirSync(cache); fs.mkdirSync(path.join(repo, "scripts/install"), { recursive: true });
  fs.cpSync(SOURCE, path.join(repo, "scripts/install/node-gyp"), { recursive: true });
  fs.copyFileSync(HELPER, path.join(repo, "scripts/install/node-gyp.sh"));
  const log = path.join(root, "npm.log"), exit = path.join(root, "outer-exit");
  fs.writeFileSync(path.join(bin, "npm"), `#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "$NPM_LOG"
[ "$1" = ci ]; [ "$2" = --prefix ]; [ "$4" = --ignore-scripts ]
[ "$5" = --no-audit ]; [ "$6" = --no-fund ]
[ -f "$3/package.json" ]; [ -f "$3/package-lock.json" ]
[ "\${FAIL_NPM:-0}" = 0 ] || exit 37
mkdir -p "$3/node_modules/.bin"
printf '#!/bin/sh\nprintf "%%s\\n" "%s"\n' "\${TOOL_VERSION:-v${VERSION}}" > "$3/node_modules/.bin/node-gyp"
chmod +x "$3/node_modules/.bin/node-gyp"
`, { mode: 0o755 });
  const runner = path.join(root, "runner.sh");
  fs.writeFileSync(runner, `#!/bin/bash
set -euo pipefail
die(){ printf '%s\n' "$*" >&2; exit 1; }
info(){ :; }
trap 'printf done > "$OUTER_EXIT"' EXIT
. "$DIR/scripts/install/node-gyp.sh"
if [ "\${IDENTITY_ONLY:-0}" = 0 ]; then ensure_node_gyp_runner; fi
printf '%s\n' "$NODE_GYP_PREFIX"
`, { mode: 0o755 });
  const run = (extra: Record<string, string> = {}) => spawnSync(runner, [], {
    encoding: "utf8", timeout: 15000,
    env: { ...process.env, DIR: repo, MSO_NODE_GYP_PREFIX: cache, PATH: `${bin}:${process.env.PATH}`, NPM_LOG: log, OUTER_EXIT: exit, ...extra },
  });
  return { root, repo, cache, log, exit, run };
}

describe("locked isolated node-gyp bootstrap", () => {
  it("pins every resolved package with integrity, not only the top-level tool version", () => {
    const p = JSON.parse(fs.readFileSync(path.join(SOURCE, "package.json"), "utf8"));
    const lock = JSON.parse(fs.readFileSync(path.join(SOURCE, "package-lock.json"), "utf8"));
    expect(p.private).toBe(true); expect(Object.keys(p.dependencies)).toEqual(["node-gyp"]);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lock.lockfileVersion).toBe(3);
    for (const [name, row] of Object.entries(lock.packages) as [string, { version: string; resolved: string; integrity: string }][]) {
      if (!name) continue;
      expect(row.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(row.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\//);
      expect(row.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
    }
  });
  it("uses frozen installation in staging, keeps the caller EXIT trap, and reuses a validated cache", () => {
    const f = fixture(), first = f.run(); expect(first.status, first.stderr).toBe(0);
    expect(first.stdout.trim()).toMatch(/\/[a-f0-9]{64}$/);
    expect(fs.readFileSync(f.log, "utf8")).toContain(".node-gyp-bootstrap.");
    expect(fs.readFileSync(f.exit, "utf8")).toBe("done");
    const second = f.run({ FAIL_NPM: "1" }); expect(second.status, second.stderr).toBe(0);
    expect(fs.readFileSync(f.log, "utf8").trim().split("\n")).toHaveLength(1);
    expect(fs.readdirSync(f.cache)).toEqual([path.basename(first.stdout.trim())]);
  });
  it("never removes unrelated node_modules from an explicit cache root", () => {
    const f = fixture(); fs.mkdirSync(path.join(f.cache, "node_modules"));
    fs.writeFileSync(path.join(f.cache, "node_modules/keep"), "owner data");
    expect(f.run().status).toBe(0);
    expect(fs.readFileSync(path.join(f.cache, "node_modules/keep"), "utf8")).toBe("owner data");
  });
  it("fails closed and cleans staging when npm fails, then allows a clean retry", () => {
    const f = fixture(), failed = f.run({ FAIL_NPM: "1" });
    expect(failed.status).toBe(37); expect(fs.readdirSync(f.cache)).toEqual([]);
    expect(fs.readFileSync(f.exit, "utf8")).toBe("done"); expect(f.run().status).toBe(0);
  });
  it("rejects a wrong tool version before publishing a cache", () => {
    const f = fixture(), failed = f.run({ TOOL_VERSION: "v0.0.0" });
    expect(failed.status).not.toBe(0); expect(failed.stderr).toContain("Unexpected node-gyp payload");
    expect(fs.readdirSync(f.cache)).toEqual([]);
  });
  it("rejects symlink cache aliases without overwriting their target", () => {
    const f = fixture(), identity = f.run({ IDENTITY_ONLY: "1" });
    expect(identity.status).toBe(0); fs.symlinkSync(f.repo, identity.stdout.trim());
    const failed = f.run(); expect(failed.status).not.toBe(0); expect(fs.existsSync(f.log)).toBe(false);
    expect(fs.readlinkSync(identity.stdout.trim())).toBe(f.repo);
  });
  it("does not execute npm when manifest and lockfile versions disagree", () => {
    const f = fixture(), file = path.join(f.repo, "scripts/install/node-gyp/package.json");
    const p = JSON.parse(fs.readFileSync(file, "utf8")); p.dependencies["node-gyp"] = "0.0.0";
    fs.writeFileSync(file, JSON.stringify(p)); expect(f.run().status).not.toBe(0);
    expect(fs.existsSync(f.log)).toBe(false);
  });
  it("keeps lifecycle mutation ordering and the native binding verification in the installer", () => {
    const runtime = fs.readFileSync("scripts/install/runtime-build.sh", "utf8");
    expect(runtime).toContain('. "$DIR/scripts/install/node-gyp.sh"');
    expect(runtime).not.toContain("npm install");
    expect(runtime.indexOf("install_runtime_lifecycle_begin")).toBeLessThan(runtime.indexOf("ensure_node_gyp_runner"));
    expect(runtime).toContain('"$NODE_GYP_BIN" rebuild'); expect(runtime).toContain("node_pty_ready || die");
  });
});
