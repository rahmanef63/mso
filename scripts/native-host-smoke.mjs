#!/usr/bin/env node
// Runs on macOS and Windows CI after a clean native candidate installation.
import { spawn, spawnSync } from "node:child_process";

const port = String(41000 + Math.floor(Math.random() * 20000));
const doctor = spawnSync(process.execPath, ["bin/mso-host.mjs", "doctor"], {
  encoding: "utf8", timeout: 15_000, windowsHide: true,
});
if (doctor.status !== 0) throw new Error(`native doctor failed: ${doctor.stderr || doctor.error}`);

const child = spawn(process.execPath, ["bin/mso-host.mjs", "start"], {
  env: { ...process.env, MSO_PORT: port }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let output = "";
child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-3000); });
child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-3000); });
const deadline = Date.now() + 45_000;
let passed = false;
try {
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1500),
      });
      const body = await response.json();
      if (response.ok && body.status === "ok" && body.service === "mso") {
        passed = true;
        break;
      }
      throw new Error(`unexpected health response: ${response.status}`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  if (!passed) throw new Error(`native server did not become healthy (exit=${child.exitCode}): ${output}`);
  console.log(`Native host healthy at loopback port ${port}`);
} finally {
  child.kill();
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
  }
}
