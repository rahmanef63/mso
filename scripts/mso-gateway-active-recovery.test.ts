import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GATEWAY, ROOT, VERSION, fixture } from "./mso-gateway-test-fixture";


describe("mso active tunnel runtime recovery", () => {
  it("restarts a dead local runtime while preserving the already-live tunnel", () => {
    const f = fixture(), root = path.join(f.dir, "recovery-root"), port = 43000 + Math.floor(Math.random() * 10000);
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.cpSync(path.join(ROOT, "scripts/lib"), path.join(root, "scripts/lib"), { recursive: true });
    fs.copyFileSync(GATEWAY, path.join(root, "scripts/mso-gateway")); fs.chmodSync(path.join(root, "scripts/mso-gateway"), 0o755);
    fs.copyFileSync(path.join(ROOT, "package.json"), path.join(root, "package.json"));
    fs.mkdirSync(path.join(root, ".next"), { recursive: true }); fs.writeFileSync(path.join(root, ".next/BUILD_ID"), "fixture\n");
    fs.mkdirSync(path.join(root, "node_modules/next/dist/bin"), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules/next/dist/bin/next"), `
const http=require('http'); const args=process.argv.slice(2); const port=Number(args[args.indexOf('--port')+1]);
http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'ok',buildId:'recovered-build',runtimeInstanceId:process.env.MSO_RUNTIME_INSTANCE_ID,version:${JSON.stringify(VERSION)}}));}).listen(port,'127.0.0.1');
process.on('SIGTERM',()=>process.exit(0));
`);
    const baseEnv = { ...f.baseEnv, MSO_GATEWAY_ROOT: root, MSO_GATEWAY_ARTIFACT_LOCK: path.join(ROOT, "security/gateway-artifacts.env"),
      MSO_GATEWAY_LOCAL_URL: `http://127.0.0.1:${port}`, MSO_RUNTIME_EXCLUSION_DIR: path.join(f.dir, "runtime-exclusion") };
    const gateway = path.join(root, "scripts/mso-gateway");
    const first = spawnSync(gateway, ["start"], { encoding: "utf8", env: baseEnv });
    expect(first.status).toBe(0);
    const before = JSON.parse(fs.readFileSync(path.join(f.state, "state.json"), "utf8")) as { tunnelIdentity: { pid: number }; runtimeOwned: boolean };
    expect(before.runtimeOwned).toBe(false);

    fs.writeFileSync(f.curl, "#!/bin/sh\nexec /usr/bin/curl \"$@\"\n", { mode: 0o700 });
    const second = spawnSync(gateway, ["start"], { encoding: "utf8", env: baseEnv, timeout: 15_000 });
    expect(second.status).toBe(0);
    const after = JSON.parse(fs.readFileSync(path.join(f.state, "state.json"), "utf8")) as {
      tunnelIdentity: { pid: number }; runtimeIdentity: { pid: number; instanceId: string }; runtimeOwned: boolean;
    };
    expect(after.tunnelIdentity.pid).toBe(before.tunnelIdentity.pid);
    expect(after.runtimeOwned).toBe(true);
    expect(after.runtimeIdentity.instanceId).toMatch(/^[0-9a-f]{32}$/);
    const health = JSON.parse(require("node:child_process").execFileSync("curl", ["-fsS", `http://127.0.0.1:${port}/api/health`], { encoding: "utf8" }));
    expect(health.buildId).toBe("recovered-build");
    expect(health.runtimeInstanceId).toBe(after.runtimeIdentity.instanceId);
    spawnSync(gateway, ["stop"], { env: baseEnv, encoding: "utf8" });
  }, 20_000);
});
