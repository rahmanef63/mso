import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GATEWAY, ROOT, VERSION, fixture, runGateway as run } from "./mso-gateway-test-fixture";


describe("mso gateway scope and public identity boundaries", () => {
  it("isolates default gateway state by checkout and selected loopback origin", () => {
    const f = fixture();
    const base: NodeJS.ProcessEnv = { ...f.baseEnv }; delete base.MSO_GATEWAY_STATE_DIR;
    const env4005 = { ...base, MSO_GATEWAY_LOCAL_URL: "http://127.0.0.1:4005" };
    const env4555 = { ...base, MSO_GATEWAY_LOCAL_URL: "http://127.0.0.1:4555" };
    const clone = path.join(f.dir, "clone-b");
    fs.mkdirSync(path.join(clone, "scripts"), { recursive: true });
    fs.cpSync(path.join(ROOT, "scripts/lib"), path.join(clone, "scripts/lib"), { recursive: true });
    fs.copyFileSync(GATEWAY, path.join(clone, "scripts/mso-gateway"));
    fs.chmodSync(path.join(clone, "scripts/mso-gateway"), 0o755);
    fs.copyFileSync(path.join(ROOT, "package.json"), path.join(clone, "package.json"));
    const envClone = { ...env4005, MSO_GATEWAY_ROOT: clone, MSO_GATEWAY_ARTIFACT_LOCK: path.join(ROOT, "security/gateway-artifacts.env") };
    try {
      run(["start"], env4005); run(["start"], env4555);
      execFileSync(path.join(clone, "scripts/mso-gateway"), ["start"], { encoding: "utf8", env: envClone });
      const stateBase = path.join(f.dir, ".mso/private/gateway");
      const states = fs.readdirSync(stateBase, { withFileTypes: true }).filter((e) => e.isDirectory())
        .map((e) => path.join(stateBase, e.name, "state.json")).filter(fs.existsSync);
      expect(states).toHaveLength(3);
      const scopes = states.map((file) => JSON.parse(fs.readFileSync(file, "utf8")) as { scopeId: string; localUrl: string; root: string });
      expect(new Set(scopes.map((v) => v.scopeId)).size).toBe(3);
      expect(new Set(scopes.map((v) => v.localUrl))).toEqual(new Set(["http://127.0.0.1:4005", "http://127.0.0.1:4555"]));
      expect(new Set(scopes.map((v) => v.root)).size).toBe(2);
    } finally {
      try { run(["stop"], env4005); } catch {}
      try { run(["stop"], env4555); } catch {}
      try { execFileSync(path.join(clone, "scripts/mso-gateway"), ["stop"], { env: envClone }); } catch {}
    }
  }, 20_000);

  it("rejects a public route whose health identity belongs to another MSO deployment", () => {
    const f = fixture();
    fs.writeFileSync(f.curl, `#!/bin/sh
case "$*" in
  *127.0.0.1:4005/api/health*) printf '%s\n' '{"status":"ok","buildId":"selected-build","runtimeInstanceId":null,"version":"${VERSION}"}' ;;
  *mso.example.test/api/health*) printf '%s\n' '{"status":"ok","buildId":"other-build","runtimeInstanceId":null,"version":"${VERSION}"}' ;;
  *) printf '%s\n' '{"status":"ok","buildId":"selected-build","runtimeInstanceId":null,"version":"${VERSION}"}' ;;
esac
`, { mode: 0o700 });
    const credentials = path.join(f.dir, "identity-tunnel.json"); fs.writeFileSync(credentials, "{}\n", { mode: 0o600 });
    const config = path.join(f.dir, "identity-tunnel.yml");
    fs.writeFileSync(config, `tunnel: fixture\ncredentials-file: ${credentials}\ningress:\n  - hostname: mso.example.test\n    service: http://127.0.0.1:4005\n  - service: http_status:404\n`, { mode: 0o600 });
    const out = spawnSync(GATEWAY, ["start", "--config", config, "--tunnel", "fixture"], { encoding: "utf8",
      env: { ...f.baseEnv, OS_PUBLIC_ORIGIN: "https://mso.example.test", MSO_GATEWAY_SKIP_PUBLIC_PROBE: "0", MSO_GATEWAY_PUBLIC_READY_SECONDS: "10" } });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("public endpoint did not return the MSO health contract");
    expect(fs.existsSync(path.join(f.state, "state.json"))).toBe(false);
  }, 15_000);

  it("refuses local runtime starts while an offline update holds the checkout exclusion", async () => {
    const f = fixture(), base = path.join(f.dir, "runtime-exclusion");
    const key = require("node:crypto").createHash("sha256").update(fs.realpathSync(ROOT)).digest("hex");
    const dir = path.join(base, key); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(base, 0o700); fs.chmodSync(dir, 0o700);
    const lock = path.join(dir, "runtime.lock"); fs.writeFileSync(lock, "", { mode: 0o600 });
    const holder = spawn("flock", ["-x", lock, "-c", "sleep 2"], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 100));
    try {
      const out = spawnSync(GATEWAY, ["local-start"], { encoding: "utf8", env: { ...f.baseEnv,
        MSO_RUNTIME_EXCLUSION_DIR: base, MSO_RUNTIME_EXCLUSION_TIMEOUT_SECONDS: "0.1" } });
      expect(out.status).not.toBe(0);
      expect(out.stderr).toContain("offline update is mutating this checkout");
    } finally {
      try { holder.kill("SIGTERM"); } catch {}
      await new Promise<void>((resolve) => holder.once("close", () => resolve()));
    }
  });

  it("does not silently ignore named-tunnel arguments while another gateway is active", () => {
    const f = fixture();
    run(["start"], f.baseEnv);
    const credentials = path.join(f.dir, "switch-tunnel.json");
    fs.writeFileSync(credentials, "{}\n", { mode: 0o600 });
    const config = path.join(f.dir, "switch-tunnel.yml");
    fs.writeFileSync(config, `tunnel: fixture\ncredentials-file: ${credentials}\ningress:\n  - hostname: mso.example.test\n    service: http://127.0.0.1:4005\n  - service: http_status:404\n`, { mode: 0o600 });
    const before = JSON.parse(fs.readFileSync(path.join(f.state, "state.json"), "utf8")) as { mode: string; tunnelIdentity: { pid: number } };
    const out = spawnSync(GATEWAY, ["start", "--config", config, "--tunnel", "fixture"], {
      encoding: "utf8", env: { ...f.baseEnv, OS_PUBLIC_ORIGIN: "https://mso.example.test" },
    });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("gateway is already active");
    expect(out.stderr).toContain("mso gateway stop");
    const after = JSON.parse(fs.readFileSync(path.join(f.state, "state.json"), "utf8")) as { mode: string; tunnelIdentity: { pid: number } };
    expect(after.mode).toBe("temporary");
    expect(after.tunnelIdentity.pid).toBe(before.tunnelIdentity.pid);
    run(["stop"], f.baseEnv);
  }, 15_000);

  it("uses kernel flock locks instead of stale-directory reclamation", () => {
    for (const name of ["gateway-lock.sh", "update-state.sh"]) {
      const source = fs.readFileSync(path.join(ROOT, "scripts/lib", name), "utf8");
      expect(source).toContain("flock -x");
      expect(source).not.toContain("transaction-stale");
      expect(source).not.toContain("lifecycle-stale");
    }
  });
});
