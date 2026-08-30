import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GATEWAY, fixture, runGateway } from "./mso-gateway-test-fixture";

function transactionLock(base: string) {
  const canonical = fs.realpathSync(process.cwd());
  const key = crypto.createHash("sha256").update(canonical).digest("hex");
  const scope = path.join(base, key); fs.mkdirSync(scope, { recursive: true, mode: 0o700 });
  fs.chmodSync(base, 0o700); fs.chmodSync(scope, 0o700);
  const lock = path.join(scope, "transaction.lock"); fs.writeFileSync(lock, "", { mode: 0o600 });
  return lock;
}

describe("gateway stop vs update restore", () => {
  it("waits for the checkout update transaction, then makes stop final", async () => {
    const f = fixture(), updateState = path.join(f.dir, "update-state"), lock = transactionLock(updateState);
    const env = { ...f.baseEnv, MSO_UPDATE_STATE_DIR: updateState, MSO_UPDATE_LOCK_TIMEOUT_SECONDS: "3" };
    runGateway(["start"], env); expect(fs.existsSync(path.join(f.state, "state.json"))).toBe(true);
    const holder = spawn("flock", ["-x", lock, "-c", "sleep 0.8"], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 80));
    const stop = spawn(GATEWAY, ["stop"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let closed = false;
    const done = new Promise<number | null>((resolve) => stop.once("close", (code) => { closed = true; resolve(code); }));
    await new Promise((r) => setTimeout(r, 180));
    expect(closed).toBe(false); expect(fs.existsSync(path.join(f.state, "state.json"))).toBe(true);
    await new Promise<void>((resolve) => holder.once("close", () => resolve()));
    expect(await done).toBe(0); expect(fs.existsSync(path.join(f.state, "state.json"))).toBe(false);
  });

  it("keeps internal runtime-stop independent of the transaction lock", async () => {
    const f = fixture(), updateState = path.join(f.dir, "update-state"), lock = transactionLock(updateState);
    const marker = path.join(f.dir, "restart-runtime");
    const env = { ...f.baseEnv, MSO_UPDATE_STATE_DIR: updateState, MSO_UPDATE_LOCK_TIMEOUT_SECONDS: "0.1", MSO_GATEWAY_RECOVERY_MARKER: marker };
    runGateway(["start"], env);
    fs.writeFileSync(f.curl, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
    const holder = spawn("flock", ["-x", lock, "-c", "sleep 0.7"], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 80));
    const out = spawnSync(GATEWAY, ["runtime-stop"], { env, encoding: "utf8" });
    expect(out.status).toBe(0); expect(out.stdout).toContain("runtime: already-down");
    holder.kill(); await new Promise<void>((resolve) => holder.once("close", () => resolve()));
    runGateway(["stop"], { ...env, MSO_UPDATE_LOCK_TIMEOUT_SECONDS: "2" });
  });
});
