import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ROOT = path.resolve(__dirname, "..");
export const GATEWAY = path.join(__dirname, "mso-gateway");
export const CLI = path.join(ROOT, "bin/mso");
export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version as string;

const tempRoots: string[] = [];
const tunnelPids = new Set<number>();

export function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mso-gateway-"));
  tempRoots.push(dir);
  const bin = path.join(dir, "bin"), state = path.join(dir, "state"), envFile = path.join(dir, ".env.local");
  fs.mkdirSync(bin, { mode: 0o700 });
  fs.writeFileSync(envFile, "OS_SESSION_SECRET=fixture-only-not-a-real-secret\n", { mode: 0o600 });

  const curl = path.join(bin, "curl");
  fs.writeFileSync(
    curl,
    `#!/bin/sh\nprintf '%s\\n' '{"status":"ok","buildId":"fixture","runtimeInstanceId":"fixture","version":"${VERSION}"}'\n`,
    { mode: 0o700 },
  );

  const cloudflared = path.join(bin, "cloudflared");
  fs.writeFileSync(
    cloudflared,
    `#!/usr/bin/env node
if (process.argv.includes('--version')) { console.log('cloudflared version fixture'); process.exit(0); }
if (process.env.OS_SESSION_SECRET || process.env.OS_LOGIN_PASSWORD) require('fs').writeFileSync(process.env.HOME + '/cloudflared-secret-env', 'leaked');
if (process.argv.includes('--url')) console.error('INF https://mso-gateway-fixture.trycloudflare.com');
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1000);
`,
    { mode: 0o700 },
  );

  const procTcp = path.join(dir, "proc-tcp"), procTcp6 = path.join(dir, "proc-tcp6");
  fs.writeFileSync(procTcp, "  sl  local_address rem_address   st\n");
  fs.writeFileSync(procTcp6, "  sl  local_address rem_address   st\n");
  const baseEnv = {
    ...process.env,
    HOME: dir,
    MSO_GATEWAY_ROOT: ROOT,
    MSO_GATEWAY_ENV: envFile,
    MSO_GATEWAY_STATE_DIR: state,
    MSO_GATEWAY_CURL: curl,
    MSO_GATEWAY_CLOUDFLARED: cloudflared,
    MSO_GATEWAY_LOCAL_URL: "http://127.0.0.1:4005",
    MSO_GATEWAY_SKIP_PUBLIC_PROBE: "1",
    MSO_GATEWAY_PROC_NET_TCP: procTcp,
    MSO_GATEWAY_PROC_NET_TCP6: procTcp6,
  };
  return { dir, bin, state, envFile, curl, cloudflared, baseEnv };
}

export function runGateway(args: string[], env: NodeJS.ProcessEnv) {
  return execFileSync(GATEWAY, args, { encoding: "utf8", env });
}

export function readFileSnapshot(file: string) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error(`expected regular file: ${file}`);
    return { mode: stat.mode & 0o777, text: fs.readFileSync(fd, "utf8") };
  } finally {
    fs.closeSync(fd);
  }
}

export function readState(stateDir: string) {
  const statePath = path.join(stateDir, "state.json"), snapshot = readFileSnapshot(statePath);
  const value = JSON.parse(snapshot.text) as {
    mode: string;
    url: string;
    tunnelIdentity: { pid: number };
    runtimeOwned: boolean;
  };
  tunnelPids.add(value.tunnelIdentity.pid);
  return { path: statePath, snapshot, value };
}

export function cleanupGatewayFixtures() {
  for (const pid of tunnelPids) {
    try { process.kill(pid, "SIGTERM"); } catch { /* already stopped */ }
  }
  tunnelPids.clear();
  for (const dir of tempRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}
