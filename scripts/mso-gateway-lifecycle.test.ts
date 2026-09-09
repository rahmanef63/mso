import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VERSION, GATEWAY, alive, fixture, identity, pids, run, waitUntil, writeState } from "./gateway-lifecycle-fixture";

describe("mso gateway lifecycle hardening", () => {
  it("rolls back a tunnel when durable state persistence fails", () => {
    const f = fixture(), pidFile = f.startFile;
    // Force the startup identity race deterministically before persistence fails.
    fs.appendFileSync(f.cloudflared, "\nprocess.on('SIGUSR1',()=>{process.title='renamed-tunnel-fixture';fs.writeFileSync(process.env.HOME+'/title-changed','1')});\n");
    const mv = path.join(f.dir, "bin", "mv");
    fs.writeFileSync(mv, `#!/bin/sh
case "$*" in *mso-private-write*state.json*)
  kill -USR1 "$(tail -n 1 "$HOME/gateway-fake-starts")"
  for i in $(seq 1 100); do [ ! -f "$HOME/title-changed" ] || break; sleep 0.01; done
  exit 1;; esac
exec /bin/mv "$@"
`, { mode: 0o700 });
    const out = spawnSync(GATEWAY, ["start"], { encoding: "utf8",
      env: f.env });
    expect(out.status).not.toBe(0); expect(out.stderr).toContain("rolled back");
    expect(fs.existsSync(path.join(f.dir, "title-changed"))).toBe(true);
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
    let stdout = "", stderr = "";
    child.stdout.on("data", (value) => stdout += value);
    child.stderr.on("data", (value) => stderr += value);
    const closed = new Promise<number | null>((resolve) => child.once("close", resolve));
    const spawned = await waitUntil(() => fs.existsSync(f.startFile) || child.exitCode !== null);
    expect(spawned && fs.existsSync(f.startFile), `gateway did not spawn fixture tunnel before exit=${child.exitCode}; stdout=${stdout.slice(-400)}; stderr=${stderr.slice(-800)}`).toBe(true);
    const tunnelPid = Number(fs.readFileSync(f.startFile, "utf8").trim().split(/\n+/).at(-1));
    pids.add(tunnelPid);
    expect(alive(tunnelPid)).toBe(true);
    child.kill("SIGTERM");
    await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error(`gateway launcher did not close after SIGTERM; stdout=${stdout.slice(-400)}; stderr=${stderr.slice(-800)}`)), 5_000))]);
    await waitUntil(() => !alive(tunnelPid), 5_000);
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

});
