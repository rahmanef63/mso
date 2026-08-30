import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const WRAPPER = path.join(process.cwd(), "scripts/mso-service-update");
const PRIVATE = path.join(process.cwd(), "scripts/lib/private-state.sh");
const UPDATE_STATE = path.join(process.cwd(), "scripts/lib/update-state.sh");
const RUNTIME_EXCLUSION = path.join(process.cwd(), "scripts/lib/runtime-exclusion.sh");
const UPDATE_GATEWAYS = path.join(process.cwd(), "scripts/lib/update-gateway-runtimes.sh");
const roots: string[] = [];

function copy(root: string, rel: string, source: string) {
  const dst = path.join(root, rel); fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(source, dst); fs.chmodSync(dst, 0o755);
}

function envIdentity(file: string) {
  const stat = fs.statSync(file);
  return { path: fs.realpathSync(file), dev: String(stat.dev), ino: String(stat.ino) };
}

function state(home: string, name: string, root: string, localUrl: string, envFile: string, runtimeOwned = true) {
  const dir = path.join(home, ".mso/private/gateway", name);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const p of [path.join(home, ".mso"), path.join(home, ".mso/private"), path.join(home, ".mso/private/gateway")]) fs.chmodSync(p, 0o700);
  fs.writeFileSync(path.join(dir, "state.json"), `${JSON.stringify({ root, localUrl, runtimeOwned, envFile: envIdentity(envFile) })}\n`, { mode: 0o600 });
}

function fixture(delayMs = 0, failRestoreUrl = "") {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mso-service-update-")); roots.push(base);
  const repo = path.join(base, "repo"), home = path.join(base, "home"), capture = path.join(base, "capture");
  fs.mkdirSync(path.join(repo, "scripts/lib"), { recursive: true }); fs.mkdirSync(home);
  copy(repo, "scripts/lib/private-state.sh", PRIVATE); copy(repo, "scripts/lib/update-state.sh", UPDATE_STATE);
  copy(repo, "scripts/lib/runtime-exclusion.sh", RUNTIME_EXCLUSION); copy(repo, "scripts/lib/update-gateway-runtimes.sh", UPDATE_GATEWAYS);
  fs.writeFileSync(path.join(repo, "scripts/mso-gateway"), `#!/bin/sh
printf '%s %s env=%s expected=%s\n' "$1" "\${MSO_GATEWAY_LOCAL_URL:-}" "\${MSO_GATEWAY_ENV:-}" "\${MSO_GATEWAY_EXPECT_ENV_IDENTITY:-}" >> ${JSON.stringify(capture)}
if [ "$1" = runtime-stop ]; then printf '1\n' > "$MSO_GATEWAY_RECOVERY_MARKER"; chmod 600 "$MSO_GATEWAY_RECOVERY_MARKER"; echo 'runtime: stopped-owned'; exit 0; fi
[ "$1" = local-start ] && { [ "${failRestoreUrl}" = "\${MSO_GATEWAY_LOCAL_URL:-}" ] && exit 31; exit 0; }
exit 2
`, { mode: 0o755 });
  fs.writeFileSync(path.join(repo, "scripts/self-update.sh"), `#!/bin/sh
printf 'self-start\n' >> ${JSON.stringify(capture)}
sleep ${Math.max(0, delayMs) / 1000}
printf 'self-end\n' >> ${JSON.stringify(capture)}
`, { mode: 0o755 });
  const canonical = fs.realpathSync(repo);
  const envOne = path.join(base, "one.env"), envTwo = path.join(base, "two.env"), envOther = path.join(base, "other.env");
  for (const file of [envOne, envTwo, envOther]) fs.writeFileSync(file, "OS_SESSION_SECRET=fixture\n", { mode: 0o600 });
  state(home, "one", canonical, "http://127.0.0.1:4555", envOne);
  state(home, "two", canonical, "http://127.0.0.1:4666", envTwo);
  state(home, "other", path.join(base, "other-checkout"), "http://127.0.0.1:4777", envOther);
  const env = { ...process.env, HOME: home, MSO_UPDATE_ROOT: repo,
    MSO_UPDATE_STATE_DIR: path.join(base, "update-state"), MSO_RUNTIME_EXCLUSION_DIR: path.join(base, "runtime-exclusion") };
  return { base, repo, capture, env, envOne, envTwo };
}

function runAsync(env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(WRAPPER, [], { env, stdio: ["ignore", "pipe", "pipe"] }); let stdout = "", stderr = "";
    child.stdout.on("data", (v) => stdout += v); child.stderr.on("data", (v) => stderr += v);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("service-active update lifecycle", () => {
  it("quiesces and restores every gateway-owned fallback runtime for this checkout", () => {
    const f = fixture(); execFileSync(WRAPPER, [], { env: f.env, encoding: "utf8" });
    const calls = fs.readFileSync(f.capture, "utf8");
    expect(calls).toContain("runtime-stop http://127.0.0.1:4555");
    expect(calls).toContain("runtime-stop http://127.0.0.1:4666");
    expect(calls).toContain("local-start http://127.0.0.1:4555");
    expect(calls).toContain("local-start http://127.0.0.1:4666");
    expect(calls).not.toContain("4777");
    expect(calls.indexOf("runtime-stop")).toBeLessThan(calls.indexOf("self-start"));
    expect(calls.lastIndexOf("local-start")).toBeGreaterThan(calls.indexOf("self-end"));
  });


  it("restores each fallback with the exact env-file identity it was launched with", () => {
    const f = fixture(); execFileSync(WRAPPER, [], { env: f.env, encoding: "utf8" });
    const calls = fs.readFileSync(f.capture, "utf8");
    expect(calls).toContain(`local-start http://127.0.0.1:4555 env=${fs.realpathSync(f.envOne)} expected={`);
    expect(calls).toContain(`local-start http://127.0.0.1:4666 env=${fs.realpathSync(f.envTwo)} expected={`);
    expect(calls).toContain(`\"path\":\"${fs.realpathSync(f.envOne)}\"`);
    expect(calls).toContain(`\"path\":\"${fs.realpathSync(f.envTwo)}\"`);
  });

  it("refuses to stop a legacy owned runtime before its env identity is migrated", () => {
    const f = fixture();
    const file = path.join(f.env.HOME as string, ".mso/private/gateway/one/state.json");
    const legacy = JSON.parse(fs.readFileSync(file, "utf8")); delete legacy.envFile;
    fs.writeFileSync(file, `${JSON.stringify(legacy)}\n`, { mode: 0o600 });
    const out = spawnSync(WRAPPER, [], { env: f.env, encoding: "utf8" });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("predates env identity");
    expect(fs.existsSync(f.capture) ? fs.readFileSync(f.capture, "utf8") : "").not.toContain("runtime-stop");
  });

  it("writes UPDATE OK only after every fallback runtime has been restored", () => {
    const f = fixture(); execFileSync(WRAPPER, [], { env: f.env, encoding: "utf8" });
    const log = fs.readFileSync(path.join(f.env.HOME as string, ".mso/self-update.log"), "utf8");
    expect(log).toContain("UPDATE OK");
    const inner = fs.readFileSync(path.join(process.cwd(), "scripts/self-update.sh"), "utf8");
    expect(inner).not.toContain("printf 'UPDATE OK");
  });

  it("does not leave a success marker when fallback restoration fails", () => {
    const f = fixture(0, "http://127.0.0.1:4666");
    const out = spawnSync(WRAPPER, [], { env: f.env, encoding: "utf8" });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("fallback runtime restore failed");
    const log = path.join(f.env.HOME as string, ".mso/self-update.log");
    expect(fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "").not.toContain("UPDATE OK");
  });

  it("clears a stale success marker before any pre-build lifecycle failure", () => {
    const f = fixture();
    const log = path.join(f.env.HOME as string, ".mso/self-update.log");
    fs.mkdirSync(path.dirname(log), { recursive: true, mode: 0o700 });
    fs.writeFileSync(log, "UPDATE OK\n", { mode: 0o600 });
    const key = createHash("sha256").update(fs.realpathSync(f.repo)).digest("hex");
    const dir = path.join(f.base, "update-state", key); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(path.join(f.base, "update-state"), 0o700);
    fs.writeFileSync(path.join(dir, "gateway-runtimes.json"), "{bad\n", { mode: 0o600 });

    const out = spawnSync(WRAPPER, [], { env: f.env, encoding: "utf8" });
    expect(out.status).not.toBe(0);
    expect(fs.readFileSync(log, "utf8")).toBe("UPDATE STARTING\n");
    expect(fs.readFileSync(log, "utf8")).not.toContain("UPDATE OK");
    expect(fs.existsSync(f.capture) ? fs.readFileSync(f.capture, "utf8") : "").not.toContain("self-start");
  });

  it("fails closed on a corrupt persisted gateway restore inventory", () => {
    const f = fixture();
    const key = createHash("sha256").update(fs.realpathSync(f.repo)).digest("hex");
    const dir = path.join(f.base, "update-state", key); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(path.join(f.base, "update-state"), 0o700);
    fs.writeFileSync(path.join(dir, "gateway-runtimes.json"), "{bad\n", { mode: 0o600 });
    const out = spawnSync(WRAPPER, [], { env: f.env, encoding: "utf8" });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toMatch(/restore inventory|inventory checkout gateway runtimes/);
    expect(fs.existsSync(f.capture) ? fs.readFileSync(f.capture, "utf8") : "").not.toContain("self-start");
  });

  it("serializes two synchronous service updates under the same checkout transaction lock", async () => {
    const f = fixture(450); const first = runAsync(f.env); await new Promise((r) => setTimeout(r, 60)); const second = runAsync(f.env);
    const [a, b] = await Promise.all([first, second]); expect(a.code).toBe(0); expect(b.code).toBe(0);
    const lifecycle = fs.readFileSync(f.capture, "utf8").split("\n").filter((v) => v.startsWith("self-"));
    expect(lifecycle).toEqual(["self-start", "self-end", "self-start", "self-end"]);
  });
});
