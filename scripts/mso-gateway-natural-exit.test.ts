import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { fixture, GATEWAY, ROOT } from "./mso-gateway-test-fixture";

function identity(pid: number) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  const rest = stat.slice(stat.lastIndexOf(") ") + 2).trim().split(/\s+/);
  return {
    pid,
    startTicks: rest[19],
    exe: fs.realpathSync(`/proc/${pid}/exe`),
    cmdHash: null,
    instanceId: "fixture",
  };
}

it("persists recovery intent when an owned fallback exited naturally before update", async () => {
  const f = fixture();
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 100));
  const runtimeIdentity = identity(child.pid!);
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => child.once("close", () => resolve()));

  const localUrl = "http://127.0.0.1:4005", canonical = fs.realpathSync(ROOT);
  const scopeId = createHash("sha256").update(`${canonical}\n${localUrl}`).digest("hex");
  fs.mkdirSync(f.state, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(f.state, "state.json"), JSON.stringify({
    scopeId, root: canonical, provider: "local", mode: "local", url: localUrl, localUrl,
    tunnelIdentity: null, runtimeIdentity, runtimeOwned: true, startedAt: "2026-01-01T00:00:00Z",
  }) + "\n", { mode: 0o600 });
  fs.writeFileSync(f.curl, "#!/bin/sh\nexit 7\n", { mode: 0o700 });

  const recoveryDir = path.join(f.dir, "recovery");
  fs.mkdirSync(recoveryDir, { mode: 0o700 });
  const marker = path.join(recoveryDir, "restart-runtime");
  const out = execFileSync(GATEWAY, ["runtime-stop"], {
    env: { ...f.baseEnv, MSO_GATEWAY_RECOVERY_MARKER: marker }, encoding: "utf8",
  });
  expect(out).toContain("runtime: recovered-stale-owned");
  const state = JSON.parse(fs.readFileSync(path.join(f.state, "state.json"), "utf8"));
  expect(state.runtimeOwned).toBe(false);
  expect(state.runtimeIdentity).toBeNull();
  expect(fs.statSync(marker).mode & 0o777).toBe(0o600);
  expect(fs.readFileSync(marker, "utf8").trim()).toBe("1");
});
