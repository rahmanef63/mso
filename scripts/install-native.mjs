#!/usr/bin/env node
// Native macOS/Windows host installer candidate. Run from a fresh repository checkout.
// This path is not wired into the public installer until real-machine acceptance passes.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const host = process.platform;
const home = os.homedir();
const envFile = path.join(root, ".env.local");

function fail(message) {
  process.stderr.write(`MSO native install: ${message}\n`);
  process.exit(1);
}

function run(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: root, stdio: options.quiet ? "pipe" : "inherit",
    encoding: "utf8", windowsHide: true, timeout: options.timeout ?? 15 * 60_000,
  });
  if (result.error || result.status !== 0) {
    fail(`${program} failed: ${result.error?.message || String(result.stderr || result.status).trim().slice(0, 300)}`);
  }
  return String(result.stdout || "").trim();
}

if (host !== "darwin" && host !== "win32") fail("use this installer only on native macOS or Windows");
const [major, minor] = process.versions.node.split(".").map(Number);
if (!((major === 22 && minor >= 12) || major === 24 || major >= 26)) {
  fail("install supported Node 22.12+, 24.x or 26+ first");
}
run("git", ["--version"], { quiet: true });
run("bun", ["--version"], { quiet: true });
if (!fs.existsSync(path.join(root, ".git"))) fail("run this file from a Git checkout of MSO");
const origin = run("git", ["remote", "get-url", "origin"], { quiet: true });
if (!/^https:\/\/github\.com\/rahmanef63\/mso(?:\.git)?\/?$/.test(origin)) {
  fail("the native candidate must run from the official public checkout");
}
if (run("git", ["status", "--porcelain"], { quiet: true })) fail("preserve uncommitted work before installation");
if (fs.existsSync(path.join(root, ".next"))) {
  fail("an existing build is present; do not replace a potentially running MSO checkout");
}

const state = path.join(home, ".mso");
fs.mkdirSync(state, { recursive: true, mode: 0o700 });
if (fs.lstatSync(state).isSymbolicLink()) fail("private state directory cannot be a symlink");

run("bun", ["install", "--frozen-lockfile"]);
run(process.execPath, ["-e", "require('node-pty')"], { quiet: true });
let generatedPassword = "";
let envFd;
try { envFd = fs.openSync(envFile, "wx", 0o600); }
catch (error) {
  if (error.code !== "EEXIST") throw error;
  if (fs.lstatSync(envFile).isSymbolicLink()) fail("refusing symlinked .env.local");
}
if (envFd !== undefined) {
  generatedPassword = randomBytes(24).toString("base64url");
  const secret = randomBytes(32).toString("hex");
  const content = `# Native MSO host. Keep this file private.
OS_LOGIN_PASSWORD=${generatedPassword}
OS_SESSION_SECRET=${secret}
OS_MCP_ENABLED=1
OS_MCP_MAX_SCOPE=read
`;
  try { fs.writeFileSync(envFd, content); } finally { fs.closeSync(envFd); }
  if (host === "win32") {
    const account = run("whoami", ["/user", "/fo", "csv", "/nh"], { quiet: true });
    const sid = account.match(/S-1-\d+(?:-\d+)+/i)?.[0];
    if (!sid) fail("could not determine the Windows user SID; review .env.local ACL before starting");
    run("icacls", [envFile, "/inheritance:r", "/grant:r", `*${sid}:(F)`], { quiet: true });
  }
}
run(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "build"]);
process.stdout.write(`Native host build ready in ${root}\n`);
if (generatedPassword && process.env.CI !== "true") process.stdout.write(`First-login password (shown once): ${generatedPassword}\n`);
process.stdout.write("Run: node bin/mso-host.mjs doctor\nRun: node bin/mso-host.mjs start\nAfter your first browser login shows a pending device, approve its exact ID locally with: node scripts/approve-device.js <device-id> \"my device\" --role owner\n");
