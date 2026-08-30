import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLI, GATEWAY, VERSION, cleanupGatewayFixtures, fixture, readFileSnapshot, readState, runGateway as run,
} from "./mso-gateway-test-fixture";

afterEach(cleanupGatewayFixtures);

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
    expect(fs.existsSync(path.join(f.dir, "cloudflared-secret-env"))).toBe(false);

    expect(run(["url"], f.baseEnv).trim()).toBe("https://mso-gateway-fixture.trycloudflare.com");
    expect(run(["status"], f.baseEnv)).toContain("Quick Tunnel is preview-only");
    expect(run(["web", "--print"], f.baseEnv).trim()).toBe("https://mso-gateway-fixture.trycloudflare.com");

    expect(run(["stop"], f.baseEnv)).toContain("MSO remains loopback-only");
    expect(fs.existsSync(state.path)).toBe(false);
    expect(() => process.kill(state.value.tunnelIdentity.pid, 0)).toThrow();
  });



  it("verifies a Quick Tunnel through Cloudflare DoH when the local resolver still has NXDOMAIN", () => {
    const f = fixture();
    fs.writeFileSync(f.curl, `#!/bin/sh
args="$*"
case "$args" in
  *cloudflare-dns.com/dns-query*) printf '%s\\n' '{"Status":0,"Answer":[{"type":1,"data":"127.0.0.1"},{"type":1,"data":"104.16.230.132"}]}' ;;
  *--resolve*) printf '%s\\n' '{"status":"ok","buildId":"fixture","runtimeInstanceId":"fixture","version":"${VERSION}"}' ;;
  *127.0.0.1:4005/api/health*) printf '%s\\n' '{"status":"ok","buildId":"fixture","runtimeInstanceId":"fixture","version":"${VERSION}"}' ;;
  *trycloudflare.com/api/health*) exit 6 ;;
  *) printf '%s\\n' '{"status":"ok","buildId":"fixture","runtimeInstanceId":"fixture","version":"${VERSION}"}' ;;
esac
`, { mode: 0o700 });
    const env = { ...f.baseEnv, MSO_GATEWAY_SKIP_PUBLIC_PROBE: "0", MSO_GATEWAY_PUBLIC_READY_SECONDS: "10" };
    const started = run(["start"], env);
    expect(started).toContain("gateway started");
    const state = readState(f.state);
    expect(state.value.url).toBe("https://mso-gateway-fixture.trycloudflare.com");
    run(["stop"], env);
  });

  it("refuses tunneling when the same MSO port already has a wildcard listener", () => {
    const f = fixture();
    const procTcp = f.baseEnv.MSO_GATEWAY_PROC_NET_TCP!;
    fs.writeFileSync(procTcp, "  sl  local_address rem_address   st\n   0: 00000000:0FA5 00000000:0000 0A\n");
    const out = spawnSync(GATEWAY, ["start"], { encoding: "utf8", env: f.baseEnv });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("already has a non-loopback listener");
    expect(fs.existsSync(path.join(f.state, "state.json"))).toBe(false);
  });


  it("also refuses a listener bound to a LAN address instead of wildcard", () => {
    const f = fixture();
    const procTcp = f.baseEnv.MSO_GATEWAY_PROC_NET_TCP!;
    // 192.168.1.1 in /proc/net/tcp little-endian form.
    fs.writeFileSync(procTcp, "  sl  local_address rem_address   st\n   0: 0101A8C0:0FA5 00000000:0000 0A\n");
    const out = spawnSync(GATEWAY, ["start"], { encoding: "utf8", env: f.baseEnv });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("non-loopback listener");
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


  it("accepts only a dedicated named tunnel config for the configured MSO origin", () => {
    const f = fixture();
    const credentials = path.join(f.dir, "tunnel.json");
    fs.writeFileSync(credentials, "{}\n", { mode: 0o600 });
    const config = path.join(f.dir, "cloudflared.yml");
    fs.writeFileSync(config, `tunnel: fixture\ncredentials-file: ${credentials}\ningress:\n  - hostname: mso.example.test\n    service: http://localhost:4005\n  - service: http_status:404\n`, { mode: 0o600 });
    const env = { ...f.baseEnv, OS_PUBLIC_ORIGIN: "https://mso.example.test" };
    const started = run(["start", "--config", config, "--tunnel", "fixture"], env);
    expect(started).toContain("https://mso.example.test");
    const state = readState(f.state);
    expect(state.value.mode).toBe("named");
    run(["stop"], env);

    fs.writeFileSync(config, `tunnel: fixture\ncredentials-file: ${credentials}\ningress:\n  - hostname: mso.example.test\n    service: http://127.0.0.1:4005\n  - hostname: other.example.test\n    service: http://127.0.0.1:9000\n  - service: http_status:404\n`, { mode: 0o600 });
    const rejected = spawnSync(GATEWAY, ["start", "--config", config, "--tunnel", "fixture"], { encoding: "utf8", env });
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain("named config must be dedicated");
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

  it("preserves a literal IPv6 loopback --base and port", () => {
    const f = fixture();
    const out = execFileSync(CLI, ["--base", "http://[::1]:4556", "web", "--local", "--print"], {
      encoding: "utf8", env: { ...process.env, HOME: f.dir, MSO_ENV: "/dev/null",
        MSO_GATEWAY_STATE_DIR: f.state, MSO_GATEWAY_CURL: f.curl, MSO_GATEWAY_CLOUDFLARED: f.cloudflared },
    });
    expect(out.trim()).toBe("http://[::1]:4556");
  });


  it("opens the Windows browser from WSL with the URL passed as data, not PowerShell code", async () => {
    const f = fixture();
    const capture = path.join(f.dir, "powershell-argv");
    const powershell = path.join(f.bin, "powershell.exe");
    fs.writeFileSync(powershell, `#!/bin/sh
printf '%s\n' "$@" > "${capture}"
`, { mode: 0o700 });
    const out = execFileSync(CLI, ["--base", "http://127.0.0.1:4555", "web", "--local"], {
      encoding: "utf8",
      env: { ...process.env, HOME: f.dir, PATH: `${f.bin}:${process.env.PATH}`, MSO_ENV: "/dev/null",
        MSO_GATEWAY_STATE_DIR: f.state, MSO_GATEWAY_CURL: f.curl, MSO_GATEWAY_CLOUDFLARED: f.cloudflared },
    });
    expect(out).toContain("opened http://127.0.0.1:4555");
    for (let i = 0; i < 50 && !fs.existsSync(capture); i++) await new Promise((r) => setTimeout(r, 10));
    const argv = fs.readFileSync(capture, "utf8").trim().split(/\n/);
    expect(argv).toContain("Start-Process $args[0]");
    expect(argv.at(-1)).toBe("http://127.0.0.1:4555");
    expect(argv.filter((v) => v.includes("http://127.0.0.1:4555"))).toHaveLength(1);
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
