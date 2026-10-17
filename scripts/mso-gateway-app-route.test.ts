import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import YAML from "yaml";
import { GATEWAY, fixture, readState, runGateway } from "./mso-gateway-test-fixture";

const TUNNEL = "11111111-2222-4333-8444-555555555555";
const HOST = "9router.mso.example.test";
const TEMPLATE = "{id}.mso.example.test";

function namedFixture(template = TEMPLATE) {
  const f = fixture(), config = path.join(f.dir, "cloudflared.yml"), credentials = path.join(f.dir, "credentials.json");
  fs.writeFileSync(credentials, "fixture-not-a-credential", { mode: 0o600 });
  fs.writeFileSync(config, `# Preserve operator settings\ntunnel: ${TUNNEL}\ncredentials-file: ${credentials}\nloglevel: info\ningress:\n  - hostname: mso.example.test\n    service: http://127.0.0.1:4005\n  - service: http_status:404\n`, { mode: 0o600 });
  fs.appendFileSync(f.envFile, `OS_PUBLIC_ORIGIN=https://mso.example.test\n${template ? `NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE=${template}\n` : ""}`);
  fs.writeFileSync(f.cloudflared, `#!/usr/bin/env node
const fs = require('fs'), home = process.env.HOME;
if (process.argv.includes('--version')) { console.log('cloudflared fixture'); process.exit(0); }
if (fs.existsSync(home + '/deny-connector')) process.exit(17);
if (process.env.OS_SESSION_SECRET) fs.writeFileSync(home + '/cloudflared-secret-env', 'leaked');
fs.appendFileSync(home + '/gateway-fake-starts', 'start\\n');
const connected = !fs.existsSync(home + '/never-connected');
if (connected) console.error('Registered tunnel connection');
process.on('SIGTERM', () => process.exit(0));
setInterval(() => { if (connected) console.error('Registered tunnel connection'); }, 1000);
`, { mode: 0o700 });
  const env = { ...f.baseEnv, NODE_ENV: "test" as const, NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE: "", MSO_GATEWAY_EXPECT_PUBLIC_ORIGIN: "https://mso.example.test", MSO_GATEWAY_EXPECT_APP_HOST_TEMPLATE: TEMPLATE };
  runGateway(["start", "--config", config, "--tunnel", TUNNEL], env);
  return { ...f, env, config, credentials };
}

function route(f: ReturnType<typeof namedFixture>, action = "ensure", host = HOST, tunnel = TUNNEL, extra = {}) {
  return spawnSync(GATEWAY, ["app-route", action, host, tunnel], { encoding: "utf8", env: { ...f.env, ...extra }, timeout: 25_000 });
}

describe("MSO-owned named gateway app routes", () => {
  it("inspects a proposed template before setup without modifying config or connector state", () => {
    const f = namedFixture("");
    const before = fs.readFileSync(f.config, "utf8"), state = readState(f.state).snapshot.text;
    const result = route(f, "inspect");
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ action: "created", hostname: HOST, tunnelId: TUNNEL });
    expect(fs.readFileSync(f.config, "utf8")).toBe(before);
    expect(readState(f.state).snapshot.text).toBe(state);
    const ensure = route(f);
    expect(ensure.status).toBe(1);
    expect(ensure.stderr).toContain("not active");
    expect(fs.readFileSync(f.config, "utf8")).toBe(before);
  }, 20_000);

  it("adds an exact route, keeps the MSO runtime identity, and does not restart again on retry", () => {
    const f = namedFixture(), stateFile = path.join(f.state, "state.json");
    const runtime = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    onTestFinished(() => { runtime.kill(); });
    const proc = fs.readFileSync(`/proc/${runtime.pid}/stat`, "utf8");
    const owned = { pid: runtime.pid, startTicks: proc.slice(proc.lastIndexOf(") ") + 2).split(" ")[19],
      exe: fs.realpathSync(`/proc/${runtime.pid}/exe`), cmdHash: null, instanceId: "fixture" };
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    fs.writeFileSync(stateFile, JSON.stringify({ ...state, runtimeOwned: true, runtimeIdentity: owned }), { mode: 0o600 });
    const before = readState(f.state).value;
    const credentialBefore = fs.statSync(f.credentials);
    const first = route(f);
    expect(first.status, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout)).toEqual({ action: "created", hostname: HOST, tunnelId: TUNNEL });
    const cfgText = fs.readFileSync(f.config, "utf8"), cfg = YAML.parse(cfgText);
    expect(cfgText).toContain("# Preserve operator settings");
    expect(cfg.loglevel).toBe("info");
    expect(cfg["credentials-file"]).toBe(f.credentials);
    expect(cfg.ingress).toEqual([
      { hostname: "mso.example.test", service: "http://127.0.0.1:4005" },
      { hostname: HOST, service: "http://127.0.0.1:4005" },
      { service: "http_status:404" },
    ]);
    const after = readState(f.state).value;
    expect(after.runtimeOwned).toBe(before.runtimeOwned);
    expect(JSON.parse(fs.readFileSync(stateFile, "utf8")).runtimeIdentity).toEqual(owned);
    expect(() => process.kill(runtime.pid!, 0)).not.toThrow();
    expect(after.tunnelIdentity.pid).not.toBe(before.tunnelIdentity.pid);
    expect(fs.statSync(f.credentials).mtimeMs).toBe(credentialBefore.mtimeMs);
    expect(fs.existsSync(path.join(f.dir, "cloudflared-secret-env"))).toBe(false);
    const second = route(f);
    expect(second.status, second.stderr).toBe(0);
    expect(JSON.parse(second.stdout).action).toBe("unchanged");
    expect(readState(f.state).value.tunnelIdentity.pid).toBe(after.tunnelIdentity.pid);
    expect(fs.readFileSync(f.startFile, "utf8").trim().split("\n")).toHaveLength(2);
  }, 30_000);

  it("retries a saved YAML route after connector startup fails while preserving the previous connector", () => {
    const f = namedFixture(), before = readState(f.state).value;
    fs.writeFileSync(path.join(f.dir, "deny-connector"), "1", { mode: 0o600 });
    const first = route(f);
    expect(first.status).toBe(1);
    expect(YAML.parse(fs.readFileSync(f.config, "utf8")).ingress[1].hostname).toBe(HOST);
    expect(readState(f.state).value.tunnelIdentity.pid).toBe(before.tunnelIdentity.pid);
    expect(() => process.kill(before.tunnelIdentity.pid, 0)).not.toThrow();
    fs.unlinkSync(path.join(f.dir, "deny-connector"));
    const second = route(f);
    expect(second.status, second.stderr).toBe(0);
    expect(JSON.parse(second.stdout).action).toBe("unchanged");
    expect(readState(f.state).value.tunnelIdentity.pid).not.toBe(before.tunnelIdentity.pid);
  }, 30_000);

  it("keeps the previous connector when an alive replacement never connects, ignoring old log traffic", () => {
    const f = namedFixture(), before = readState(f.state).snapshot.text;
    const previous = readState(f.state).value.tunnelIdentity;
    fs.writeFileSync(path.join(f.dir, "never-connected"), "1", { mode: 0o600 });
    const result = route(f, "ensure", HOST, TUNNEL, { MSO_GATEWAY_PUBLIC_READY_SECONDS: "10" });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("did not register a tunnel connection");
    expect(readState(f.state).snapshot.text).toBe(before);
    expect(() => process.kill(previous.pid, 0)).not.toThrow();
    expect(fs.readFileSync(path.join(f.state, "provider.log"), "utf8")).toContain("Registered tunnel connection");
    expect(fs.readFileSync(f.startFile, "utf8").trim().split("\n")).toHaveLength(2);
  }, 30_000);

  it.each([
    { label: "wrong origin", host: HOST, tunnel: TUNNEL, extra: { MSO_GATEWAY_EXPECT_PUBLIC_ORIGIN: "https://other.example.test" } },
    { label: "unknown app", host: "other.mso.example.test", tunnel: TUNNEL, extra: {} },
    { label: "wrong tunnel", host: HOST, tunnel: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", extra: {} },
  ])("rejects $label without changing the named config", ({ host, tunnel, extra }) => {
    const f = namedFixture(), before = fs.readFileSync(f.config, "utf8");
    const result = route(f, "ensure", host, tunnel, extra);
    expect(result.status).toBe(1);
    expect(fs.readFileSync(f.config, "utf8")).toBe(before);
  }, 20_000);

  it("does not adopt an externally managed gateway", () => {
    const f = fixture();
    const env = { ...f.baseEnv, OS_PUBLIC_ORIGIN: "https://mso.example.test", MSO_GATEWAY_EXPECT_PUBLIC_ORIGIN: "https://mso.example.test", MSO_GATEWAY_EXPECT_APP_HOST_TEMPLATE: TEMPLATE };
    const result = spawnSync(GATEWAY, ["app-route", "ensure", HOST, TUNNEL], { encoding: "utf8", env });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("existing MSO-owned named Cloudflare gateway");
    expect(fs.existsSync(f.startFile)).toBe(false);
  });
});
