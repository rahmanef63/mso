import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GATEWAY, fixture, runGateway } from "./mso-gateway-test-fixture";

describe("gateway env-file identity", () => {
  it("persists only canonical path/device/inode and never env contents", () => {
    const f = fixture(); runGateway(["start"], f.baseEnv);
    const raw = fs.readFileSync(path.join(f.state, "state.json"), "utf8");
    const state = JSON.parse(raw) as { envFile: { path: string; dev: string; ino: string } };
    const stat = fs.statSync(f.envFile);
    expect(state.envFile).toEqual({ path: fs.realpathSync(f.envFile), dev: String(stat.dev), ino: String(stat.ino) });
    expect(raw).not.toContain("fixture-only-not-a-real-secret");
    runGateway(["stop"], f.baseEnv);
  });

  it("refuses a restore expectation after the env file is atomically replaced", () => {
    const f = fixture(); runGateway(["start"], f.baseEnv);
    const state = JSON.parse(fs.readFileSync(path.join(f.state, "state.json"), "utf8")) as { envFile: unknown };
    runGateway(["stop"], f.baseEnv);
    const replacement = path.join(f.dir, "replacement.env");
    fs.writeFileSync(replacement, "OS_SESSION_SECRET=replaced\n", { mode: 0o600 });
    fs.renameSync(replacement, f.envFile);
    const out = spawnSync(GATEWAY, ["status"], {
      encoding: "utf8",
      env: { ...f.baseEnv, MSO_GATEWAY_EXPECT_ENV_IDENTITY: JSON.stringify(state.envFile) },
    });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("env file identity changed while runtime was quiesced");
  });
});
