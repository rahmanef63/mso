import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "../..");
const HELPER = path.join(ROOT, "scripts/lib/private-state.sh");
const CLI = path.join(ROOT, "bin/mso");
const EDITOR = path.join(ROOT, "claude-skills/mso-image-editor/image-editor.sh");
const ULTIMATE = path.join(ROOT, "scripts/security-ultimate.sh");
const roots: string[] = [];

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-private-state-"));
  fs.chmodSync(root, 0o700);
  roots.push(root);
  return root;
}

function bash(body: string) {
  return spawnSync("bash", ["-c", `set -euo pipefail; . ${JSON.stringify(HELPER)}; ${body}`], {
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("private shell state", () => {
  it("creates owner-only directories and 0600 regular files", () => {
    const root = tempRoot();
    const file = path.join(root, "nested", "cookie.jar");
    const run = bash(`p=$(mso_private_state_ensure_file ${JSON.stringify(file)}); printf '%s' "$p"`);
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(file);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(file).isFile()).toBe(true);
  });

  it("refuses a pre-created symlink without touching its target", () => {
    const root = tempRoot();
    const dir = path.join(root, "private");
    fs.mkdirSync(dir, { mode: 0o700 });
    const target = path.join(root, "target");
    fs.writeFileSync(target, "sentinel", { mode: 0o600 });
    const file = path.join(dir, "cookie.jar");
    fs.symlinkSync(target, file);
    const run = bash(`mso_private_state_ensure_file ${JSON.stringify(file)}`);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("refusing symlink file");
    expect(fs.readFileSync(target, "utf8")).toBe("sentinel");
  });

  it("refuses an existing file whose permissions are not 0600", () => {
    const root = tempRoot();
    const dir = path.join(root, "private");
    fs.mkdirSync(dir, { mode: 0o700 });
    const file = path.join(dir, "cookie.jar");
    fs.writeFileSync(file, "exposed", { mode: 0o600 });
    // The ultimate gate deliberately runs under umask 077. Node applies umask to
    // the create mode, so `{ mode: 0o644 }` alone can silently create 0600 and make
    // this negative fixture test the safe path instead. Force the post-create mode.
    fs.chmodSync(file, 0o644);
    const run = bash(`mso_private_state_ensure_file ${JSON.stringify(file)}`);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("file must be mode 0600");
    expect(fs.readFileSync(file, "utf8")).toBe("exposed");
    expect(fs.statSync(file).mode & 0o777).toBe(0o644);
  });

  it("atomically replaces only a validated regular session file", () => {
    const root = tempRoot();
    const file = path.join(root, "private", "session.json");
    const first = bash(`printf '%s' '{"v":1}' | mso_private_state_atomic_write ${JSON.stringify(file)} >/dev/null`);
    expect(first.status).toBe(0);
    const second = bash(`printf '%s' '{"v":2}' | mso_private_state_atomic_write ${JSON.stringify(file)} >/dev/null`);
    expect(second.status).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toBe('{"v":2}');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("propagates atomic rename failure even when the caller invokes it from a conditional", () => {
    const root = tempRoot();
    const dir = path.join(root, "private"), bin = path.join(root, "bin");
    fs.mkdirSync(dir, { mode: 0o700 }); fs.mkdirSync(bin, { mode: 0o700 });
    const file = path.join(dir, "session.json");
    fs.writeFileSync(file, "old", { mode: 0o600 });
    fs.writeFileSync(path.join(bin, "mv"), "#!/bin/sh\nexit 33\n", { mode: 0o700 });
    const run = bash(`PATH=${JSON.stringify(bin)}:$PATH; if printf new | mso_private_state_atomic_write ${JSON.stringify(file)} >/dev/null; then echo unexpected; exit 91; else echo failed; fi`);
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe("failed");
    expect(fs.readFileSync(file, "utf8")).toBe("old");
    expect(fs.readdirSync(dir).filter((name) => name.startsWith(".mso-private-write."))).toEqual([]);
  });

  it("wires both clients away from shared /tmp defaults and validates every bearer file", () => {
    const cli = fs.readFileSync(CLI, "utf8");
    const editor = fs.readFileSync(EDITOR, "utf8");
    expect(cli).toContain("$HOME/.mso/private");
    expect(cli).not.toContain('${TMPDIR:-/tmp}/mso-$(id -u)');
    expect(cli).toContain('mso_private_state_validate_file "$JAR"');
    expect(editor).toContain("$HOME/.mso/private");
    expect(editor).not.toContain("${TMPDIR:-/tmp}/mso-image-editor.jar");
    expect(editor).not.toContain("${TMPDIR:-/tmp}/mso-image-editor.session.json");
    expect(editor).toContain('mso_private_state_atomic_write "$SESS"');
  });

  it("keeps shell scripts syntactically valid and the ultimate runner self-sufficient", () => {
    for (const script of [HELPER, CLI, EDITOR, ULTIMATE]) {
      expect(() => execFileSync("bash", ["-n", script])).not.toThrow();
    }
    const ultimate = fs.readFileSync(ULTIMATE, "utf8");
    expect(ultimate).toContain('export PATH="$HOME/.bun/bin:$HOME/.local/bin:');
  });
});
