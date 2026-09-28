#!/usr/bin/env node
// Native host launcher candidate. The full cross-platform CLI is a separate gate.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
const envFile = path.join(root, ".env.local");
const port = Number(process.env.MSO_PORT || 4005);
const command = process.argv[2] || "help";

function fail(message) {
  process.stderr.write(`MSO host: ${message}\n`);
  process.exitCode = 1;
}

function ready() {
  if (!["darwin", "win32"].includes(process.platform)) {
    fail("this launcher is for a native Mac or Windows host");
    return false;
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    fail("MSO_PORT must be a local TCP port from 1024 to 65535");
    return false;
  }
  if (!fs.existsSync(envFile) || !fs.existsSync(next) || !fs.existsSync(path.join(root, ".next"))) {
    fail("run node scripts/install-native.mjs from a clean checkout first");
    return false;
  }
  try {
    const pty = spawnSync(process.execPath, ["-e", "require('node-pty')"], {
      cwd: root, timeout: 10_000, windowsHide: true,
    });
    if (pty.status !== 0) throw new Error("node-pty binding unavailable");
  } catch (error) {
    fail(error.message);
    return false;
  }
  return true;
}

if (command === "version" || command === "--version") {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  process.stdout.write(`MSO ${pkg.version} · native ${os.platform()} host candidate\n`);
} else if (command === "doctor") {
  if (ready()) process.stdout.write(`Native host preflight passed. Run 'node bin/mso-host.mjs start', then check http://127.0.0.1:${port}/api/health and terminal login.\n`);
} else if (command === "start") {
  if (ready()) {
    process.stdout.write(`Starting MSO at http://127.0.0.1:${port} (Ctrl+C to stop)\n`);
    const child = spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: root, env: process.env, stdio: "inherit", windowsHide: true,
    });
    child.on("error", (error) => fail(error.message));
    child.on("exit", (code) => { process.exitCode = code ?? 1; });
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.on(signal, () => child.kill(signal));
    }
  }
} else if (command === "help" || command === "--help") {
  process.stdout.write("MSO native host candidate: doctor | start | version\n");
  process.stdout.write("Existing Linux CLI verbs and remote relay are not available through this launcher yet.\n");
} else {
  fail(`unknown native host command: ${command}`);
}
