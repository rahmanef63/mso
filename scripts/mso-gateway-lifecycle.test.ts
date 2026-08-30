import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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

afterEach(() => {
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, "SIGTERM"); } catch {}
  pids.clear(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("mso gateway lifecycle hardening", () => {
  it("rolls back a tunnel when durable state persistence fails", () => {
    const f = fixture(), pidFile = f.startFile;
    const mv = path.join(f.dir, "bin", "mv");
    fs.writeFileSync(mv, `#!/bin/sh
case "$*" in *mso-private-write*state.json*) exit 1;; esac
exec /bin/mv "$@"
`, { mode: 0o700 });
    const out = spawnSync(GATEWAY, ["start"], { encoding: "utf8",
      env: f.env });
    expect(out.status).not.toBe(0); expect(out.stderr).toContain("rolled back");
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim()); pids.add(pid); expect(alive(pid)).toBe(false);
    expect(fs.existsSync(path.join(f.state, "state.json"))).toBe(false);
  });


  it("fails closed on empty or symlinked persisted state instead of treating it as absent", () => {
    const empty = fixture(); fs.writeFileSync(path.join(empty.state, "state.json"), "", { mode: 0o600 });
    let out = spawnSync(GATEWAY, ["status"], { encoding: "utf8", env: empty.env });
    expect(out.status).not.toBe(0); expect(out.stderr).toContain("gateway state is empty");

    const linked = fixture(), target = path.join(linked.dir, "outside.json");
    fs.writeFileSync(target, "{}\n", { mode: 0o600 }); fs.symlinkSync(target, path.join(linked.state, "state.json"));
    out = spawnSync(GATEWAY, ["status"], { encoding: "utf8", env: linked.env });
    expect(out.status).not.toBe(0); expect(out.stderr).toContain("unsafe gateway state file");
  });

  it("never kills a reused PID whose persisted process identity no longer matches", async () => {
    const f = fixture();
    const child = spawn(f.cloudflared, ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:4005"], { env: f.env });
    await new Promise((r) => setTimeout(r, 120)); pids.add(child.pid!);
    const wrong = { ...identity(child.pid!), startTicks: "0" };
    writeState(f.state, { provider: "fixture", mode: "temporary", url: "https://old.example", localUrl: "http://127.0.0.1:4005",
      tunnelIdentity: wrong, runtimeIdentity: null, runtimeOwned: false, startedAt: "2026-01-01T00:00:00Z" });
    run(["stop"], f.env); expect(alive(child.pid!)).toBe(true);
  });


  it("can stop an owned Next-style process even after its argv/process title changes", async () => {
    const f = fixture();
    const child = spawn(process.execPath, ["-e", "process.title='next-server (fixture)';process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)"]);
    await new Promise((r) => setTimeout(r, 120)); pids.add(child.pid!);
    const relaxed = { ...identity(child.pid!), cmdHash: null, instanceId: "fixture" };
    writeState(f.state, { provider: "local", mode: "local", url: "http://127.0.0.1:4005", localUrl: "http://127.0.0.1:4005",
      tunnelIdentity: null, runtimeIdentity: relaxed, runtimeOwned: true, startedAt: "2026-01-01T00:00:00Z" });
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    run(["stop"], f.env); await Promise.race([closed, new Promise((r) => setTimeout(r, 600))]);
    expect(alive(child.pid!)).toBe(false);
  });


  it("rolls back an unpersisted tunnel when the launcher is terminated during readiness", async () => {
    const f = fixture();
    const curl = path.join(f.dir, "bin", "curl-wait");
    fs.writeFileSync(curl, `#!/bin/sh
case "$*" in
  *127.0.0.1:4005/api/health*) printf '%s\n' '{"status":"ok","buildId":"fixture","runtimeInstanceId":"fixture","version":"${VERSION}"}' ;;
  *) exit 22 ;;
esac
`, { mode: 0o700 });
    const env = { ...f.env, MSO_GATEWAY_CURL: curl, MSO_GATEWAY_SKIP_PUBLIC_PROBE: "0", MSO_GATEWAY_PUBLIC_READY_SECONDS: "10" };
    const child = spawn(GATEWAY, ["start"], { env, stdio: ["ignore", "pipe", "pipe"] });
    for (let i = 0; i < 100 && !fs.existsSync(f.startFile); i++) await new Promise((r) => setTimeout(r, 20));
    expect(fs.existsSync(f.startFile)).toBe(true);
    const tunnelPid = Number(fs.readFileSync(f.startFile, "utf8").trim().split(/\n+/).at(-1));
    pids.add(tunnelPid);
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => child.once("close", () => resolve()));
    for (let i = 0; i < 50 && alive(tunnelPid); i++) await new Promise((r) => setTimeout(r, 20));
    expect(alive(tunnelPid)).toBe(false);
    expect(fs.existsSync(path.join(f.state, "state.json"))).toBe(false);
  });

  it("local-start preserves an active tunnel while retaining an owned runtime", async () => {
    const f = fixture();
    const tunnel = spawn(f.cloudflared, ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:4005"], { env: f.env });
    const runtime = spawn(process.execPath, ["-e", "process.title='next-server (fixture)';process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)"]);
    await new Promise((r) => setTimeout(r, 150));
    pids.add(tunnel.pid!); pids.add(runtime.pid!);
    const tid = identity(tunnel.pid!);
    const rid = { ...identity(runtime.pid!), cmdHash: null, instanceId: "fixture" };
    writeState(f.state, { provider: "cloudflare-quick", mode: "temporary", url: "https://life-fixture.trycloudflare.com",
      localUrl: "http://127.0.0.1:4005", tunnelIdentity: tid, runtimeIdentity: rid, runtimeOwned: true, startedAt: "2026-01-01T00:00:00Z" });
    run(["local-start"], f.env);
    const state = JSON.parse(fs.readFileSync(path.join(f.state, "state.json"), "utf8"));
    expect(state.tunnelIdentity).toEqual(tid);
    expect(state.runtimeIdentity).toEqual(rid);
    expect(alive(tunnel.pid!)).toBe(true);
    run(["stop"], f.env);
    for (let i = 0; i < 50 && (alive(tunnel.pid!) || alive(runtime.pid!)); i++) await new Promise((r) => setTimeout(r, 20));
    expect(alive(tunnel.pid!)).toBe(false); expect(alive(runtime.pid!)).toBe(false);
  });

  it("persists recovery intent before stopping and reconciles stale ownership after a state-write failure", async () => {
    const f = fixture();
    const runtime = spawn(process.execPath, ["-e", "process.title='next-server (fixture)';process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)"], { stdio: "ignore" });
    const pid = runtime.pid!;
    pids.add(pid);
    await new Promise((r) => setTimeout(r, 120));
    const rid = { ...identity(pid), cmdHash: null, instanceId: "fixture" };
    writeState(f.state, { provider: "cloudflare-quick", mode: "temporary", url: "https://life-fixture.trycloudflare.com",
      localUrl: "http://127.0.0.1:4005", tunnelIdentity: null, runtimeIdentity: rid, runtimeOwned: true, startedAt: "2026-01-01T00:00:00Z" });
    const recoveryDir = path.join(f.dir, "update-recovery");
    fs.mkdirSync(recoveryDir, { mode: 0o700 });
    const markerPath = path.join(recoveryDir, "restart-runtime");
    const mv = path.join(f.dir, "bin", "mv");
    fs.writeFileSync(mv, `#!/bin/sh
case "$*" in *mso-private-write*state.json*) exit 1;; esac
exec /bin/mv "$@"
`, { mode: 0o700 });
    const env = { ...f.env, MSO_GATEWAY_RECOVERY_MARKER: markerPath };
    const first = spawnSync(GATEWAY, ["runtime-stop"], { encoding: "utf8", env });
    expect(first.status).not.toBe(0);
    expect(first.stderr).toContain("recovery marker preserved");
    for (let i = 0; i < 80 && alive(pid); i++) await new Promise((r) => setTimeout(r, 20));
    expect(alive(pid)).toBe(false);
    const recoveryMarker = readRegularSnapshot(markerPath);
    expect(recoveryMarker.mode).toBe(0o600);
    expect(recoveryMarker.text.trim()).toBe("1");
    expect(JSON.parse(fs.readFileSync(path.join(f.state, "state.json"), "utf8")).runtimeOwned).toBe(true);

    fs.unlinkSync(mv);
    fs.writeFileSync(f.curl, "#!/bin/sh\nexit 7\n", { mode: 0o700 });
    const second = run(["runtime-stop"], env);
    expect(second).toContain("runtime: recovered-stale-owned");
    const reconciled = JSON.parse(fs.readFileSync(path.join(f.state, "state.json"), "utf8"));
    expect(reconciled.runtimeOwned).toBe(false);
    expect(reconciled.runtimeIdentity).toBeNull();
    expect(readRegularSnapshot(markerPath).text.trim()).toBe("1");
  });

  it("serializes concurrent starts so only one public tunnel is spawned", async () => {
    const f = fixture(), startFile = f.startFile, env = f.env;
    const [a, b] = await Promise.all([asyncStart(env), asyncStart(env)]);
    expect(a.code).toBe(0); expect(b.code).toBe(0);
    const spawned = fs.readFileSync(startFile, "utf8").trim().split(/\n+/).filter(Boolean);
    expect(spawned).toHaveLength(1); pids.add(Number(spawned[0])); run(["stop"], f.env);
  });

  it("preserves owned runtime identity when only the old tunnel died", async () => {
    const f = fixture();
    const runtime = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)"]);
    await new Promise((r) => setTimeout(r, 100)); pids.add(runtime.pid!);
    const rid = { ...identity(runtime.pid!), cmdHash: null, instanceId: "fixture" };
    writeState(f.state, { provider: "fixture", mode: "temporary", url: "https://dead.example", localUrl: "http://127.0.0.1:4005",
      tunnelIdentity: null, runtimeIdentity: rid, runtimeOwned: true, startedAt: "2026-01-01T00:00:00Z" });
    run(["start"], f.env); const state = JSON.parse(fs.readFileSync(path.join(f.state, "state.json"), "utf8"));
    expect(state.runtimeOwned).toBe(true); expect(state.runtimeIdentity).toEqual(rid);
    const closed = new Promise<void>((resolve) => runtime.once("close", () => resolve()));
    run(["stop"], f.env); await Promise.race([closed, new Promise((r) => setTimeout(r, 500))]);
    expect(alive(runtime.pid!)).toBe(false);
  });

  it("does not accept an arbitrary 2xx /api/health body as MSO", () => {
    const f = fixture(); fs.writeFileSync(f.curl, "#!/bin/sh\nprintf '{}\\n'\n", { mode: 0o700 });
    const out = run(["doctor"], f.env); expect(out).toContain("no verified MSO runtime");
  });
});
