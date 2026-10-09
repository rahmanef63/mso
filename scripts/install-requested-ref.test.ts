import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let root: string, repo: string, exact: string;
const git = (...args: string[]) => execFileSync("git", args, {cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "mso-install-ref-")); repo = root;
  git("init", "-q", "-b", "main"); git("config", "user.name", "fixture"); git("config", "user.email", "fixture@example.test");
  writeFileSync(path.join(repo, "marker"), "requested"); git("add", "marker"); git("commit", "-qm", "requested");
  exact = git("rev-parse", "HEAD"); git("tag", "requested-tag");
  writeFileSync(path.join(repo, "marker"), "default"); git("commit", "-qam", "default");
});
afterEach(() => rmSync(root, {recursive: true, force: true}));

function checkout(ref: string) {
  const core = readFileSync("scripts/install-core.sh", "utf8");
  const start = core.indexOf('  install_git_noninteractive git clone --quiet --no-checkout');
  const end = core.indexOf('\nfi\ncd "$DIR"', start);
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  const script = 'set -eu\ndie() { echo "$*" >&2; exit 1; }\ninstall_git_noninteractive() { "$@"; }\n' + core.slice(start, end) + '\nprintf "checkout=%s\\n" "$(git -C "$DIR" rev-parse HEAD)"\n';
  const dir = path.join(root, "installed");
  const result = spawnSync("bash", ["-c", script], {encoding: "utf8", env: {...process.env, REPO_URL: repo, DIR: dir, REF: ref}});
  return {dir, result};
}
describe("fresh installer requested-ref authority", () => {
  it.each(["tag", "commit"])("checks out an exact %s instead of the default branch", (kind) => {
    const {dir, result} = checkout(kind === "tag" ? "requested-tag" : exact);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`checkout=${exact}`);
    expect(readFileSync(path.join(dir, "marker"), "utf8")).toBe("requested");
  });
  it("fails closed for a missing ref without checking out or executing the default branch", () => {
    const {dir, result} = checkout("missing-ref");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("could not fetch requested ref missing-ref");
    expect(() => readFileSync(path.join(dir, "marker"))).toThrow();
    expect(result.stdout).not.toContain("checkout=");
  });
});
