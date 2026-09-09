import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture(script: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), "mso-worktree-gate-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  mkdirSync(path.join(repo, "scripts"), { recursive: true });
  copyFileSync(
    path.join(process.cwd(), "scripts", script),
    path.join(repo, "scripts", script),
  );
  if (script === "verify-build.sh") {
    copyFileSync(
      path.join(process.cwd(), "scripts", "ensure-playwright-browser.mjs"),
      path.join(repo, "scripts", "ensure-playwright-browser.mjs"),
    );
  }
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };
  mkdirSync(path.join(repo, "scripts/e2e"), { recursive: true });
  writeFileSync(
    path.join(repo, "scripts/e2e/release.mjs"),
    "import fs from 'node:fs'; if (!fs.existsSync('.build-verified') || fs.existsSync('.env.local')) throw Error('unsafe E2E fixture'); console.log('isolated E2E fixture passed');",
  );
  git("init", "-q");
  git("add", "scripts");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "fixture",
  );
  return { root, repo, git };
}

describe("isolated worktree release guards", () => {
  it("installs the shared hook from a linked worktree whose .git is a file", () => {
    const { root, repo, git } = fixture("gates.sh");
    const work = path.join(root, "linked");
    git("worktree", "add", "-qb", "linked-test", work);
    expect(statSync(path.join(work, ".git")).isFile()).toBe(true);
    const run = spawnSync("bash", ["scripts/gates.sh", "--install"], {
      cwd: work,
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
    const hook = path.join(repo, ".git/hooks/pre-push");
    expect(readFileSync(hook, "utf8")).toContain("scripts/gates.sh");
    expect(statSync(hook).mode & 0o111).not.toBe(0);
  });

  it("builds a committed archive with copied dependency contents and no local secrets", () => {
    const { root, repo } = fixture("verify-build.sh");
    const modules = path.join(root, "modules");
    mkdirSync(path.join(modules, ".bin"), { recursive: true });
    writeFileSync(
      path.join(modules, ".bin/next"),
      `const fs=require('node:fs'); if(fs.lstatSync('node_modules').isSymbolicLink()) throw Error('outside-root symlink'); if(fs.existsSync('.env.local')) throw Error('secret copied'); fs.writeFileSync('.build-verified','ok'); console.log('isolated build fixture passed');`,
    );
    const playwrightTest = path.join(modules, "@playwright/test");
    mkdirSync(playwrightTest, { recursive: true });
    writeFileSync(
      path.join(playwrightTest, "package.json"),
      JSON.stringify({
        name: "@playwright/test",
        type: "module",
        exports: "./index.mjs",
      }),
    );
    writeFileSync(
      path.join(playwrightTest, "index.mjs"),
      `export const chromium = { executablePath: () => "/bin/sh" };`,
    );
    symlinkSync(modules, path.join(repo, "node_modules"), "dir");
    writeFileSync(
      path.join(repo, ".env.local"),
      "# synthetic local configuration\n",
    );
    mkdirSync(path.join(repo, ".next"));
    writeFileSync(path.join(repo, ".next/keep"), "live marker");
    const run = spawnSync("bash", ["scripts/verify-build.sh"], {
      cwd: repo,
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("isolated build fixture passed");
    expect(run.stdout).toContain("Playwright Chromium ready");
    expect(run.stdout).toContain("isolated E2E fixture passed");
    expect(readFileSync(path.join(repo, ".next/keep"), "utf8")).toBe(
      "live marker",
    );
    expect(existsSync(path.join(repo, ".env.local"))).toBe(true);
  });

  it("bootstraps only the package-matched Chromium binary without sudo", () => {
    const source = readFileSync(
      path.join(process.cwd(), "scripts/ensure-playwright-browser.mjs"),
      "utf8",
    );
    expect(source).toContain(
      '["node_modules/playwright/cli.js", "install", "chromium"]',
    );
    expect(source).toContain("chromium.executablePath()");
    expect(source).not.toContain('"sudo"');
    expect(source).not.toContain('"install-deps"');
  });
});

describe("root test inventory", () => {
  it("registers every root-level test in the normal verification gate", () => {
    const config = readFileSync(
      path.join(process.cwd(), "vitest.config.mts"),
      "utf8",
    );
    for (const file of readdirSync(process.cwd()).filter((name) =>
      /\.test\.tsx?$/.test(name),
    )) {
      expect(config, `unregistered root test: ${file}`).toContain(
        JSON.stringify(file),
      );
    }
  });
});
