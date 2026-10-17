import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { GATEWAY, ROOT, fixture, runGateway } from "./mso-gateway-test-fixture";

const TUNNEL = "11111111-2222-4333-8444-555555555555", HOST = "9router.mso.example.test";
const TEMPLATE = "{id}.mso.example.test";
function processIdentity(pid: number) {
  const proc = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  return { pid, startTicks: proc.slice(proc.lastIndexOf(") ") + 2).split(" ")[19], exe: fs.realpathSync(`/proc/${pid}/exe`),
    cmdHash: createHash("sha256").update(fs.readFileSync(`/proc/${pid}/cmdline`)).digest("hex") };
}
function stop(pid: number) { try { process.kill(pid, "SIGTERM"); } catch { /* already stopped by the gateway */ } }

async function interruptedSwap() {
  const f = fixture(), config = path.join(f.dir, "cloudflared.yml"), credential = path.join(f.dir, "credential.json");
  fs.writeFileSync(credential, "fixture-credential-metadata-only", { mode: 0o600 });
  fs.writeFileSync(config, `tunnel: ${TUNNEL}\ncredentials-file: ${credential}\ningress:\n  - hostname: mso.example.test\n    service: http://127.0.0.1:4005\n  - hostname: ${HOST}\n    service: http://127.0.0.1:4005\n  - service: http_status:404\n`, { mode: 0o600 });
  fs.appendFileSync(f.envFile, `OS_PUBLIC_ORIGIN=https://mso.example.test\nNEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE=${TEMPLATE}\n`);
  fs.writeFileSync(f.cloudflared, `#!/usr/bin/env node
const fs = require('fs');
if (fs.existsSync(process.env.HOME + '/deny-connector')) process.exit(17);
console.error('Registered tunnel connection');
process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);
`, { mode: 0o700 });
  const env = { ...f.baseEnv, NODE_ENV: "test" as const, MSO_GATEWAY_EXPECT_PUBLIC_ORIGIN: "https://mso.example.test", MSO_GATEWAY_EXPECT_APP_HOST_TEMPLATE: TEMPLATE };
  runGateway(["start", "--config", config, "--tunnel", TUNNEL], env);
  const stateFile = path.join(f.state, "state.json"), recordFile = path.join(f.state, "app-route-reload.json");
  const original = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  onTestFinished(() => stop(original.tunnelIdentity.pid));
  const replacement = spawn(process.execPath, [f.cloudflared, "tunnel", "--config", config, "--no-autoupdate", "run", TUNNEL], { stdio: "ignore", env: { ...env, HOME: f.dir } });
  const dead = processIdentity(replacement.pid!);
  await new Promise<void>((resolve) => { replacement.once("exit", () => resolve()); replacement.kill(); });
  const record = { root: fs.realpathSync(ROOT), scopeId: original.scopeId, configPath: config, tunnelId: TUNNEL, phase: "pending",
    configSha256: createHash("sha256").update(fs.readFileSync(config)).digest("hex"), previousIdentity: original.tunnelIdentity, tunnelIdentity: dead };
  fs.writeFileSync(stateFile, JSON.stringify({ ...original, tunnelIdentity: dead }), { mode: 0o600 });
  fs.writeFileSync(recordFile, JSON.stringify(record), { mode: 0o600 });
  return { ...f, env, config, stateFile, recordFile, original, record };
}
function ensure(f: Awaited<ReturnType<typeof interruptedSwap>>) {
  return spawnSync(GATEWAY, ["app-route", "ensure", HOST, TUNNEL], { encoding: "utf8", env: f.env, timeout: 25_000 });
}

describe("interrupted named connector swaps", () => {
  it("restores a proven live prior connector before normal validation, then completes the saved route on retry", async () => {
    const f = await interruptedSwap();
    const inspect = spawnSync(GATEWAY, ["app-route", "inspect", HOST, TUNNEL], { encoding: "utf8", env: f.env });
    expect(inspect.status).toBe(1);
    expect(JSON.parse(fs.readFileSync(f.stateFile, "utf8")).tunnelIdentity).toEqual(f.record.tunnelIdentity);
    fs.writeFileSync(path.join(f.dir, "deny-connector"), "1", { mode: 0o600 });
    const first = ensure(f);
    expect(first.status, first.stderr).toBe(1);
    expect(first.stderr).toContain("replacement connector did not start");
    expect(JSON.parse(fs.readFileSync(f.stateFile, "utf8"))).toEqual(f.original);
    expect(() => process.kill(f.original.tunnelIdentity.pid, 0)).not.toThrow();
    fs.unlinkSync(path.join(f.dir, "deny-connector"));
    const second = ensure(f);
    expect(second.status, second.stderr).toBe(0);
    expect(JSON.parse(second.stdout)).toEqual({ action: "unchanged", tunnelId: TUNNEL, hostname: HOST });
    const after = JSON.parse(fs.readFileSync(f.stateFile, "utf8"));
    expect(after.runtimeIdentity).toEqual(f.original.runtimeIdentity);
    expect(after.runtimeOwned).toBe(f.original.runtimeOwned);
    expect(after.envFile).toEqual(f.original.envFile);
    expect(after.tunnelIdentity.pid).not.toBe(f.original.tunnelIdentity.pid);
    expect(JSON.parse(fs.readFileSync(f.recordFile, "utf8")).phase).toBe("ready");
  }, 40_000);

  it.each(["root", "scopeId", "configPath", "tunnelId", "replacement"])("refuses a mismatched %s recovery receipt", async (field) => {
    const f = await interruptedSwap(), before = fs.readFileSync(f.stateFile, "utf8");
    const record: Record<string, unknown> = { ...f.record };
    if (field === "replacement") record.tunnelIdentity = { ...f.record.tunnelIdentity, startTicks: "0" };
    else record[field] = "unrelated";
    fs.writeFileSync(f.recordFile, JSON.stringify(record), { mode: 0o600 });
    const result = ensure(f);
    expect(result.status).toBe(1);
    expect(fs.readFileSync(f.stateFile, "utf8")).toBe(before);
    expect(() => process.kill(f.original.tunnelIdentity.pid, 0)).not.toThrow();
  }, 25_000);

  it("does not adopt an alive unrelated process from a malformed pending receipt", async () => {
    const f = await interruptedSwap(), before = fs.readFileSync(f.stateFile, "utf8");
    const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    onTestFinished(() => stop(unrelated.pid!));
    fs.writeFileSync(f.recordFile, JSON.stringify({ ...f.record, previousIdentity: processIdentity(unrelated.pid!) }), { mode: 0o600 });
    const result = ensure(f);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("MSO-owned launch recipe");
    expect(fs.readFileSync(f.stateFile, "utf8")).toBe(before);
    expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
  }, 25_000);
});
