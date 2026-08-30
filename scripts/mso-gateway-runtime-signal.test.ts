import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GATEWAY, ROOT, VERSION, fixture } from "./mso-gateway-test-fixture";

const pids = new Set<number>();
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
afterEach(() => {
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, "SIGTERM"); } catch {}
  pids.clear();
});

describe("mso fallback runtime signal safety", () => {
  it("cleans a fallback runtime when the launcher is terminated before state persistence", async () => {
    const f = fixture(), root = path.join(f.dir, "runtime-root");
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.cpSync(path.join(ROOT, "scripts/lib"), path.join(root, "scripts/lib"), { recursive: true });
    fs.copyFileSync(GATEWAY, path.join(root, "scripts/mso-gateway")); fs.chmodSync(path.join(root, "scripts/mso-gateway"), 0o755);
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: VERSION }));
    fs.mkdirSync(path.join(root, ".next"), { recursive: true }); fs.writeFileSync(path.join(root, ".next/BUILD_ID"), "fixture\n");
    fs.mkdirSync(path.join(root, "node_modules/next/dist/bin"), { recursive: true });
    const pidFile = path.join(f.dir, "runtime-pid");
    fs.writeFileSync(path.join(root, "node_modules/next/dist/bin/next"), `
const http=require('http'), fs=require('fs'); const args=process.argv.slice(2);
const port=Number(args[args.indexOf('--port')+1]); fs.writeFileSync(process.env.MSO_TEST_RUNTIME_PID_FILE, String(process.pid));
http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'ok',buildId:'fixture',runtimeInstanceId:process.env.MSO_RUNTIME_INSTANCE_ID,version:${JSON.stringify(VERSION)}}));}).listen(port,'127.0.0.1');
process.on('SIGTERM',()=>process.exit(0));
`);
    const port = 41000 + Math.floor(Math.random() * 10000), curl = path.join(f.dir, "bin", "curl-never-ready");
    fs.writeFileSync(curl, "#!/bin/sh\nexit 7\n", { mode: 0o700 });
    const state = path.join(f.dir, "runtime-state");
    const env = { ...f.baseEnv, MSO_GATEWAY_ROOT: root, MSO_GATEWAY_ARTIFACT_LOCK: path.join(ROOT, "security/gateway-artifacts.env"),
      MSO_GATEWAY_STATE_DIR: state, MSO_GATEWAY_LOCAL_URL: `http://127.0.0.1:${port}`, MSO_GATEWAY_CURL: curl, MSO_TEST_RUNTIME_PID_FILE: pidFile };
    const child = spawn(path.join(root, "scripts/mso-gateway"), ["local-start"], { env, stdio: ["ignore", "pipe", "pipe"] });
    for (let i = 0; i < 150 && !fs.existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 20));
    expect(fs.existsSync(pidFile)).toBe(true);
    const runtimePid = Number(fs.readFileSync(pidFile, "utf8")); pids.add(runtimePid);
    child.kill("SIGTERM"); await new Promise<void>((resolve) => child.once("close", () => resolve()));
    for (let i = 0; i < 100 && alive(runtimePid); i++) await new Promise((r) => setTimeout(r, 20));
    expect(alive(runtimePid)).toBe(false);
    expect(fs.existsSync(path.join(state, "state.json"))).toBe(false);
  }, 15_000);
});
