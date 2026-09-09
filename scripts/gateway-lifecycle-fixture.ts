import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const GATEWAY = path.join(__dirname, "mso-gateway");
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version as string;
const roots: string[] = [];
const pids = new Set<number>();

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mso-gateway-life-")); roots.push(dir);
  const bin = path.join(dir, "bin"), state = path.join(dir, "state"), envFile = path.join(dir, ".env.local");
  fs.mkdirSync(bin, { mode: 0o700 }); fs.mkdirSync(state, { mode: 0o700 });
  fs.writeFileSync(envFile, "OS_SESSION_SECRET=fixture\n", { mode: 0o600 });
  const curl = path.join(bin, "curl");
  fs.writeFileSync(curl, `#!/bin/sh\nprintf '%s\\n' '{"status":"ok","buildId":"fixture","runtimeInstanceId":"fixture","version":"${VERSION}"}'\n`, { mode: 0o700 });
  const cloudflared = path.join(bin, "cloudflared");
  fs.writeFileSync(cloudflared, `#!/usr/bin/env node
const fs=require('fs');
if(process.argv.includes('--version')){console.log('cloudflared fixture');process.exit(0)}
fs.appendFileSync(process.env.HOME + '/gateway-fake-starts', process.pid+'\\n');
if(process.argv.includes('--url'))console.error('INF https://life-fixture.trycloudflare.com');
process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);
`, { mode: 0o700 });
  const procTcp = path.join(dir, "proc-tcp"), procTcp6 = path.join(dir, "proc-tcp6");
  fs.writeFileSync(procTcp, "  sl  local_address rem_address   st\n"); fs.writeFileSync(procTcp6, "  sl  local_address rem_address   st\n");
  const env = { ...process.env, HOME: dir, PATH: `${bin}:${process.env.PATH}`, MSO_GATEWAY_ROOT: ROOT, MSO_GATEWAY_ENV: envFile,
    MSO_GATEWAY_STATE_DIR: state, MSO_GATEWAY_CURL: curl, MSO_GATEWAY_CLOUDFLARED: cloudflared,
    MSO_GATEWAY_LOCAL_URL: "http://127.0.0.1:4005", MSO_GATEWAY_SKIP_PUBLIC_PROBE: "1",
    MSO_GATEWAY_PROC_NET_TCP: procTcp, MSO_GATEWAY_PROC_NET_TCP6: procTcp6 };
  return { dir, state, curl, cloudflared, startFile: path.join(dir, "gateway-fake-starts"), env };
}

function run(args: string[], env: NodeJS.ProcessEnv) { return execFileSync(GATEWAY, args, { encoding: "utf8", env }); }
function identity(pid: number) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  const rest = stat.slice(stat.lastIndexOf(") ") + 2).trim().split(/\s+/);
  return { pid, startTicks: rest[19], exe: fs.realpathSync(`/proc/${pid}/exe`),
    cmdHash: createHash("sha256").update(fs.readFileSync(`/proc/${pid}/cmdline`)).digest("hex") };
}
function writeState(dir: string, value: Record<string, unknown>) {
  const localUrl = String(value.localUrl ?? "http://127.0.0.1:4005");
  const root = fs.realpathSync(ROOT);
  const scopeId = createHash("sha256").update(`${root}\n${localUrl}`).digest("hex");
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ scopeId, root, ...value }), { mode: 0o600 });
}
function readRegularSnapshot(file: string) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error(`expected regular file: ${file}`);
    return { mode: stat.mode & 0o777, text: fs.readFileSync(fd, "utf8") };
  } finally { fs.closeSync(fd); }
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const rest = stat.slice(stat.lastIndexOf(") ") + 2);
    return rest[0] !== "Z";
  } catch { return false; }
}
function asyncStart(env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(GATEWAY, ["start"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = ""; child.stdout.on("data", (v) => stdout += v); child.stderr.on("data", (v) => stderr += v);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs = 8_000, intervalMs = 25): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return predicate();
}

afterEach(() => {
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, "SIGTERM"); } catch {}
  pids.clear(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});


export { VERSION, alive, asyncStart, fixture, GATEWAY, identity, pids, readRegularSnapshot, ROOT, run, waitUntil, writeState };
