import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const GATEWAY = path.join(__dirname, "mso-gateway");
const CLI = path.join(ROOT, "bin/mso");
const tempRoots: string[] = [];
const tunnelPids = new Set<number>();

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mso-gateway-"));
  tempRoots.push(dir);
  const bin = path.join(dir, "bin");
  const state = path.join(dir, "state");
  const envFile = path.join(dir, ".env.local");
  fs.mkdirSync(bin, { mode: 0o700 });
  fs.writeFileSync(envFile, "OS_SESSION_SECRET=fixture-only-not-a-real-secret\n", { mode: 0o600 });

  const curl = path.join(bin, "curl");
  fs.writeFileSync(curl, "#!/bin/sh\nexit 0\n", { mode: 0o700 });

  const cloudflared = path.join(bin, "cloudflared");
  fs.writeFileSync(
    cloudflared,
    `#!/usr/bin/env node
if (process.argv.includes('--version')) { console.log('cloudflared version fixture'); process.exit(0); }
if (process.argv.includes('--url')) console.error('INF https://mso-gateway-fixture.trycloudflare.com');
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1000);
`,
    { mode: 0o700 },
  );

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
  };
  return { dir, bin, state, envFile, curl, cloudflared, baseEnv };
}

function run(args: string[], env: NodeJS.ProcessEnv) {
  return execFileSync(GATEWAY, args, { encoding: "utf8", env });
}

function readFileSnapshot(file: string) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error(`expected regular file: ${file}`);
    return { mode: stat.mode & 0o777, text: fs.readFileSync(fd, "utf8") };
  } finally {
    fs.closeSync(fd);
  }
}

function readState(stateDir: string) {
  const p = path.join(stateDir, "state.json");
  const snapshot = readFileSnapshot(p);
  const value = JSON.parse(snapshot.text) as {
    mode: string;
    url: string;
    tunnelPid: number;
    runtimeOwned: boolean;
  };
  tunnelPids.add(value.tunnelPid);
  return { path: p, snapshot, value };
}

afterEach(() => {
  for (const pid of tunnelPids) {
    try { process.kill(pid, "SIGTERM"); } catch { /* already stopped */ }
  }
  tunnelPids.clear();
  for (const dir of tempRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("mso public gateway", () => {
  it("runs a temporary HTTPS gateway without publishing the MSO app port", () => {
    const f = fixture();
    const started = run(["start"], f.baseEnv);
    expect(started).toContain("gateway started");
    expect(started).toContain("https://mso-gateway-fixture.trycloudflare.com");
    expect(started).toContain("still loopback-only");

    const state = readState(f.state);
    expect(state.value.mode).toBe("temporary");
    expect(state.value.url).toBe("https://mso-gateway-fixture.trycloudflare.com");
    expect(state.value.runtimeOwned).toBe(false);
    expect(fs.statSync(f.state).mode & 0o777).toBe(0o700);
    expect(state.snapshot.mode).toBe(0o600);
    expect(state.snapshot.text).not.toContain("OS_SESSION_SECRET");

    expect(run(["url"], f.baseEnv).trim()).toBe("https://mso-gateway-fixture.trycloudflare.com");
    expect(run(["status"], f.baseEnv)).toContain("Quick Tunnel is temporary preview mode");
    expect(run(["web", "--print"], f.baseEnv).trim()).toBe("https://mso-gateway-fixture.trycloudflare.com");

    expect(run(["stop"], f.baseEnv)).toContain("MSO remains loopback-only");
    expect(fs.existsSync(state.path)).toBe(false);
    expect(() => process.kill(state.value.tunnelPid, 0)).toThrow();
  });

  it("fails closed on a non-loopback upstream", () => {
    const f = fixture();
    const out = spawnSync(GATEWAY, ["start"], {
      encoding: "utf8",
      env: { ...f.baseEnv, MSO_GATEWAY_LOCAL_URL: "http://0.0.0.0:4005" },
    });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("refusing non-loopback/invalid upstream");
    expect(fs.existsSync(path.join(f.state, "state.json"))).toBe(false);
  });

  it("does not confuse a hostname beginning with 127 for loopback", () => {
    const f = fixture();
    const out = spawnSync(GATEWAY, ["start"], {
      encoding: "utf8",
      env: { ...f.baseEnv, MSO_GATEWAY_LOCAL_URL: "http://127.attacker.example:4005" },
    });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("refusing non-loopback/invalid upstream");
  });

  it("rejects a group/world-writable named-tunnel config", () => {
    const f = fixture();
    const config = path.join(f.dir, "cloudflared.yml");
    fs.writeFileSync(config, "tunnel: fixture\n", { mode: 0o666 });
    fs.chmodSync(config, 0o666);
    const out = spawnSync(GATEWAY, ["start", "--config", config, "--tunnel", "fixture"], {
      encoding: "utf8",
      env: { ...f.baseEnv, OS_PUBLIC_ORIGIN: "https://mso.example.test" },
    });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("must not be group/world-writable");
  });

  it("atomically sets and clears a clean HTTPS stable origin without touching other env values", () => {
    const f = fixture();
    run(["domain", "set", "https://mso.example.test"], f.baseEnv);
    let snapshot = readFileSnapshot(f.envFile);
    let text = snapshot.text;
    expect(text).toContain("OS_SESSION_SECRET=fixture-only-not-a-real-secret");
    expect(text).toContain("OS_PUBLIC_ORIGIN=https://mso.example.test");
    expect(snapshot.mode).toBe(0o600);

    const bad = spawnSync(GATEWAY, ["domain", "set", "http://mso.example.test/path"], {
      encoding: "utf8",
      env: f.baseEnv,
    });
    expect(bad.status).not.toBe(0);
    expect(readFileSnapshot(f.envFile).text).toBe(text);

    run(["domain", "clear"], f.baseEnv);
    snapshot = readFileSnapshot(f.envFile);
    text = snapshot.text;
    expect(text).toContain("OS_SESSION_SECRET=fixture-only-not-a-real-secret");
    expect(text).not.toContain("OS_PUBLIC_ORIGIN=");
  });

  it("mso web follows an explicit loopback --base including a non-default port", () => {
    const f = fixture();
    const out = execFileSync(CLI, ["--base", "http://127.0.0.1:4555", "web", "--local", "--print"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: f.dir,
        MSO_ENV: "/dev/null",
        MSO_GATEWAY_STATE_DIR: f.state,
        MSO_GATEWAY_CURL: f.curl,
        MSO_GATEWAY_CLOUDFLARED: f.cloudflared,
      },
    });
    expect(out.trim()).toBe("http://127.0.0.1:4555");
  });
});
