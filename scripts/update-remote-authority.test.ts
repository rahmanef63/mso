import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const HELPER = new URL("./lib/update-remote-authority.sh", import.meta.url);
const roots: string[] = [];

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function repo(origin: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-remote-authority-"));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "remote", "add", "origin", origin);
  return root;
}

function prepare(root: string) {
  execFileSync("bash", ["-c", 'source "./lib/update-remote-authority.sh"; update_prepare_origin "$1"', "_", root], { cwd: new URL(".", import.meta.url), encoding: "utf8" });
  return git(root, "remote", "get-url", "origin");
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("MSO update remote authority", () => {
  it("normalizes canonical SSH origins to public HTTPS", () => {
    expect(prepare(repo("git@github.com:rahmanef63/mso.git"))).toBe("https://github.com/rahmanef63/mso.git");
    expect(prepare(repo("ssh://git@github.com/rahmanef63/mso"))).toBe("https://github.com/rahmanef63/mso.git");
  });

  it("keeps canonical public HTTPS stable", () => {
    expect(prepare(repo("https://github.com/rahmanef63/mso.git"))).toBe("https://github.com/rahmanef63/mso.git");
  });

  it("never rewrites explicit HTTPS or SSH forks/private origins", () => {
    expect(prepare(repo("https://github.com/example/mso.git"))).toBe("https://github.com/example/mso.git");
    expect(prepare(repo("git@github.com:example/private-mso.git"))).toBe("git@github.com:example/private-mso.git");
  });

  it("forces non-interactive fetch while still honoring an explicit SSH command", () => {
    const source = fs.readFileSync(HELPER, "utf8");
    expect(source).toContain("GIT_TERMINAL_PROMPT=0");
    expect(source).toContain('GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -oBatchMode=yes}"');
    expect(source).toContain('git -C "$root" fetch --quiet "$@" origin "$ref"');
  });
});
