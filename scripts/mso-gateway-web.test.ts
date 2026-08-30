import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GATEWAY, fixture, readState, runGateway } from "./mso-gateway-test-fixture";

function runAsync(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(GATEWAY, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (v) => stdout += v); child.stderr.on("data", (v) => stderr += v);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function stopTunnelWhileWebWaits(mode: "auto" | "public") {
  const f = fixture();
  runGateway(["start"], f.baseEnv);
  const state = readState(f.state), lock = path.join(f.state, "lifecycle.lock");
  const holder = spawn("flock", ["-x", lock, "-c", "sleep 0.7"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 80));
  const web = runAsync(["web", ...(mode === "public" ? ["--public"] : []), "--print"], f.baseEnv);
  await new Promise((r) => setTimeout(r, 120));
  try { process.kill(state.value.tunnelIdentity.pid, "SIGTERM"); } catch { /* already gone */ }
  await new Promise<void>((resolve) => holder.once("close", () => resolve()));
  return web;
}

describe("mso web routing", () => {
  it("falls back to loopback when a public origin is configured but no gateway is active", () => {
    const f = fixture();
    const out = runGateway(["web", "--print"], { ...f.baseEnv, OS_PUBLIC_ORIGIN: "https://mso.example.test" });
    expect(out.trim()).toBe("http://127.0.0.1:4005");
  });

  it("rechecks state under the lifecycle lock and auto-falls back when the tunnel dies while waiting", async () => {
    const out = await stopTunnelWhileWebWaits("auto");
    expect(out.code).toBe(0); expect(out.stdout.trim()).toBe("http://127.0.0.1:4005");
    expect(out.stderr).not.toContain("unbound variable");
  });

  it("rechecks state under the lifecycle lock and public mode fails cleanly when the tunnel dies", async () => {
    const out = await stopTunnelWhileWebWaits("public");
    expect(out.code).not.toBe(0); expect(out.stderr).toContain("public gateway is not running");
    expect(out.stderr).not.toContain("unbound variable");
  });
});
