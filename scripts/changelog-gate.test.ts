import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Two separate failures led here, both of which let `main` go red without CI noticing:
//
//   1. `docs/CHANGELOG.md` is generated from commit subjects, so a hand-made docs commit
//      leaves it stale the moment it lands. Three docs-only commits in one session each
//      needed a second commit to fix.
//   2. The staleness check lived only in the local pre-push hook and in gates-12.sh. CI
//      runs `bun run check`, which did not include it — so a squash merge could leave the
//      file stale again and every CI run stayed green.
//
// This pins both: the generator's `--check` really fails on a stale file, and the CI-facing
// `check` script actually invokes it. A gate nobody runs is not a gate.

const ROOT = path.resolve(__dirname, "..");

describe("changelog staleness gate", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("is wired into the script CI runs, not just the local hook", () => {
    const scripts = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts as Record<string, string>;
    expect(scripts.check, "CI runs `bun run check`; the gate must be in it").toContain("gen-changelog.mjs --check");
    // The pre-push hook already had it; keep both, since a local run should fail too.
    expect(readFileSync(path.join(ROOT, "scripts/gates.sh"), "utf8")).toContain("gen-changelog.mjs --check");
    expect(readFileSync(path.join(ROOT, "scripts/gates-12.sh"), "utf8")).toContain("gen-changelog.mjs --check");
  });

  it("exits non-zero when the file does not match history", () => {
    // A repo-shaped fixture: two commits, and a changelog that lists neither.
    const root = mkdtempSync(path.join(os.tmpdir(), "mso-changelog-gate-"));
    roots.push(root);
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "scripts/gen-changelog.mjs"), readFileSync(path.join(ROOT, "scripts/gen-changelog.mjs")));
    writeFileSync(path.join(root, "docs/CHANGELOG.md"), "# Changelog\n\nstale placeholder\n");

    const git = (...args: string[]) =>
      spawnSync("git", args, { cwd: root, encoding: "utf8" });
    git("init", "-q");
    writeFileSync(path.join(root, "a.txt"), "a");
    git("-c", "user.name=T", "-c", "user.email=t@example.invalid", "add", "-A");
    git("-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "feat(x): a real change");

    const stale = spawnSync(process.execPath, ["scripts/gen-changelog.mjs", "--check"], { cwd: root, encoding: "utf8" });
    expect(stale.status, "a changelog that omits a commit must fail the gate").toBe(1);
    expect(stale.stderr).toMatch(/stale/i);

    // Regenerating must make it current, and stay current on a second check — that is
    // what stops the "regenerate, then stale again" loop.
    expect(spawnSync(process.execPath, ["scripts/gen-changelog.mjs"], { cwd: root, encoding: "utf8" }).status).toBe(0);
    const fresh = spawnSync(process.execPath, ["scripts/gen-changelog.mjs", "--check"], { cwd: root, encoding: "utf8" });
    expect(fresh.status, "after regenerating the gate must pass").toBe(0);
    expect(fresh.stdout + fresh.stderr).toMatch(/current/i);
  });
});
