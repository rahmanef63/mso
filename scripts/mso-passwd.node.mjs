import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, chmodSync, lstatSync, existsSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, spawn } from "node:child_process";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "mso-passwd-test-"));
chmodSync(tmp, 0o700);
after(() => rmSync(tmp, { recursive: true, force: true }));
let number = 0;
function fixture() {
  const root = path.join(tmp, String(number++));
  mkdirSync(root, { mode: 0o700 });
  for (const name of ["bin/mso", "scripts/cli/passwd.sh", "scripts/cli/local-maintenance.sh", "scripts/cli/help.sh", "scripts/mso-passwd.ts", "lib/auth/local-password.ts", "lib/auth/login-password.ts", "lib/auth/session.ts"]) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true, mode: 0o700 });
    copyFileSync(path.join(repo, name), path.join(root, name));
  }
  // `login-password.ts` follows the Nakama admin password after a rotation. That
  // module reaches `@/lib/*` aliases, which do not resolve inside this copied
  // fixture, and this suite is about the login password rather than the follow-up.
  // A stub keeps the fixture self-contained; the real follower has its own suite in
  // lib/auth/nakama-password.test.ts.
  writeFileSync(
    path.join(root, "lib/auth/nakama-password.ts"),
    'export async function followNakamaPassword(): Promise<"not_configured"> { return "not_configured"; }\n',
    { mode: 0o600 },
  );
  return root;
}
const env = { ...process.env, MSO_ENV: "", OS_ENV: "", MSO_BASE: "", OS_BASE: "" };
const run = (root, action, values = []) => spawnSync("bun", [path.join(root, "scripts/mso-passwd.ts"), root, action], {
  env, encoding: "utf8", input: values.length ? values.join("\0") + "\0" : "",
});
const set = (root, current = "", next = "fixture-next-123", confirm = next) => run(root, "set", [current, next, confirm]);
const seed = (root, text = "OS_LOGIN_PASSWORD=fixture-current\nOS_SESSION_SECRET=fixture-session-key-never-used-live\nOS_MCP_ENABLED=0\nOTHER=keep\n") => {
  writeFileSync(path.join(root, ".env.local"), text, { mode: 0o600 });
};

test("fresh setup uses the existing env source, private permissions and disabled MCP", () => {
  const root = fixture();
  assert.equal(run(root, "status").stdout.trim(), '{"configured":false,"sessionConfigured":false}');
  const out = set(root);
  assert.equal(out.status, 0, out.stderr);
  const file = path.join(root, ".env.local"), text = readFileSync(file, "utf8");
  assert.match(text, /^OS_LOGIN_PASSWORD=fixture-next-123$/m);
  assert.match(text, /^OS_SESSION_SECRET=[a-f0-9]{64}$/m);
  assert.match(text, /^OS_MCP_ENABLED=0$/m);
  assert.equal(lstatSync(file).mode & 0o777, 0o600);
  assert.ok(!out.stdout.includes("fixture-next-123"));
  assert.ok(!existsSync(path.join(root, ".mso")));
});

test("rotation verifies the current password and preserves session secret/config", () => {
  const root = fixture(); seed(root);
  const out = set(root, "fixture-current");
  assert.equal(out.status, 0, out.stderr);
  const text = readFileSync(path.join(root, ".env.local"), "utf8");
  assert.match(text, /OS_SESSION_SECRET=fixture-session-key-never-used-live/);
  assert.match(text, /OTHER=keep/);
  assert.match(text, /OS_LOGIN_PASSWORD=fixture-next-123/);
  assert.ok(!out.stdout.includes("fixture-current"));
  const status = run(root, "status");
  assert.deepEqual(JSON.parse(status.stdout), { configured: true, sessionConfigured: true });
  assert.ok(!status.stdout.includes("fixture-"));
});

test("wrong current, mismatch, weak input and unsafe files never mutate the file", () => {
  const root = fixture(); seed(root);
  const file = path.join(root, ".env.local"), before = readFileSync(file, "utf8");
  for (const values of [["wrong-current", "fixture-next-123", "fixture-next-123"], ["fixture-current", "fixture-next-123", "different"], ["fixture-current", "bad pass", "bad pass"]]) {
    assert.notEqual(run(root, "set", values).status, 0);
    assert.equal(readFileSync(file, "utf8"), before);
  }
  chmodSync(file, 0o640);
  assert.notEqual(set(root, "fixture-current").status, 0);
  assert.equal(readFileSync(file, "utf8"), before);
  const other = fixture();
  symlinkSync(file, path.join(other, ".env.local"));
  assert.notEqual(set(other).status, 0);
});

test("rejects ambiguous env, unsafe parent and secret arguments without echoing", () => {
  const root = fixture(); seed(root, "OS_LOGIN_PASSWORD=first-one\nOS_LOGIN_PASSWORD=second-one\n");
  assert.notEqual(set(root).status, 0);
  const other = fixture(); chmodSync(other, 0o777);
  assert.notEqual(set(other).status, 0);
  const clean = fixture();
  const out = spawnSync("bash", [path.join(clean, "bin/mso"), "passwd", "fixture-argument"], { env, encoding: "utf8" });
  assert.notEqual(out.status, 0);
  assert.ok(!(out.stdout + out.stderr).includes("fixture-argument"));
  assert.ok(!existsSync(path.join(clean, ".env.local")));
});

test("concurrent fresh setup publishes one complete configuration", async () => {
  const root = fixture();
  const launch = () => new Promise(resolve => {
    const child = spawn("bun", [path.join(root, "scripts/mso-passwd.ts"), root, "set"], { env, stdio: ["pipe", "ignore", "ignore"] });
    child.stdin.on("error", () => {});
    child.stdin.end("\0fixture-next-123\0fixture-next-123\0");
    child.on("close", resolve);
  });
  const results = await Promise.all([launch(), launch()]);
  assert.equal(results.filter(code => code === 0).length, 1);
  assert.match(readFileSync(path.join(root, ".env.local"), "utf8"), /^OS_SESSION_SECRET=[a-f0-9]{64}$/m);
});

test("help/status do not create session state, remote targets and non-TTY input fail closed", () => {
  const root = fixture(), home = path.join(root, "home"); mkdirSync(home);
  const invoke = args => spawnSync("bash", [path.join(root, "bin/mso"), ...args], { env: { ...env, HOME: home }, encoding: "utf8", input: "fixture-next-123\n" });
  assert.equal(invoke(["-h"]).status, 0);
  assert.match(invoke(["-h"]).stdout, /passwd \[status\]/);
  assert.equal(invoke(["passwd", "--help"]).status, 0);
  assert.equal(invoke(["passwd", "status"]).status, 0);
  assert.notEqual(invoke(["--base", "https://example.invalid", "passwd"]).status, 0);
  assert.notEqual(invoke(["passwd"]).status, 0);
  assert.ok(!existsSync(path.join(home, ".mso")));
  assert.ok(!existsSync(path.join(root, ".env.local")));
});

test("real PTY hides passwords, requires confirmation, and cancels without credentials", () => {
  const out = spawnSync("python3", [path.join(repo, "scripts/cli/passwd-pty-test.py"), fixture(), fixture()], { env, encoding: "utf8", timeout: 20000 });
  assert.equal(out.status, 0, out.stderr || out.stdout);
});
