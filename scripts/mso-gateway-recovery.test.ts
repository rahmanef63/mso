import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GATEWAY, alive, asyncStart, fixture, identity, pids, readRegularSnapshot, run, writeState } from "./gateway-lifecycle-fixture";

describe("mso gateway lifecycle hardening", () => {
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

  it.each(["direct", "interpreter exec"])("serializes concurrent starts so only one tunnel remains live and tracked (%s)", async mode => {
    const f = fixture(), startFile = f.startFile, env = f.env;
    if (mode === "interpreter exec") {
      fs.renameSync(f.cloudflared, f.cloudflared + ".cjs");
      // Preserve PID/start ticks while startup changes executable and argv.
      fs.writeFileSync(f.cloudflared, `#!/bin/bash
sleep 0.3
exec node -e 'require(process.argv[1] + ".cjs")' "$0" "$@"
`, { mode: 0o700 });
    }
    const [a, b] = await Promise.all([asyncStart(env), asyncStart(env)]);
    expect(a.code).toBe(0); expect(b.code).toBe(0);
    const spawned = fs.readFileSync(startFile, "utf8").trim().split(/\n+/).filter(Boolean).map(Number);
    for (const pid of spawned) pids.add(pid);
    expect(spawned).toHaveLength(1);
    const live = spawned.filter(alive);
    expect(live).toHaveLength(1);
    const state = JSON.parse(fs.readFileSync(path.join(f.state, "state.json"), "utf8"));
    expect(state.tunnelIdentity.pid).toBe(live[0]);
    expect(state.tunnelIdentity).toMatchObject(identity(live[0]));
    run(["stop"], f.env);
    for (let i = 0; i < 50 && spawned.some(alive); i++) await new Promise((r) => setTimeout(r, 20));
    expect(spawned.filter(alive)).toEqual([]);
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
