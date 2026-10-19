// Synthetic, loopback-only harness for the managed-app internal-rewrite regression.
//
// Nothing here touches owner state, services, DNS, or real credentials: a fake Orca
// upstream plus an owner-only Orca managed root (status + runtime-identity files and
// a real owned `node` process so the readiness bridge can verify process identity).
// The fake upstream child process itself owns the actual HTTP upstream listener socket,
// so its kernel PID matches the server-identity receipt.
// The fake upstream proves the server-side rewrite reaches the upstream instead of
// self-hopping; it is explicitly NOT evidence of E2E Orca/browser acceptance.
import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";

export const COCKPIT = "https://cockpit.example.test";
export const APP_HOST = "orca.mso.example.com";
export const APP_ORIGIN = `https://${APP_HOST}`;
export const ORCA_VERSION = "1.4.230";
export const RUNTIME_ID = "fixture-orca-runtime";

/** Strip every credential-shaped value before anything is printed or persisted. */
export const redact = (text) => String(text)
  .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
  .replace(/(__Host-[A-Za-z0-9_-]+=)[^;,\s"]+/gi, "$1<redacted>")
  .replace(/(app_ticket=)[A-Za-z0-9._-]+/gi, "$1<redacted>")
  .replace(/orca:\/\/pair#[A-Za-z0-9_-]+/gi, "orca://pair#<redacted>")
  .replace(/((?:cookie|authorization|set-cookie)"?\s*[:=]\s*"?)[^\n"]+/gi, "$1<redacted>");

/** Create temporary fixture directory under Hermes scratch task root when available. */
export async function createFixtureDirectory(prefix = "mso-orca-rewrite-") {
  const scratchBase = process.env.HERMES_SCRATCH_TASK_ROOT || "/home/antinrml/.hermes/cache/scratch/antigravity";
  try {
    await mkdir(scratchBase, { recursive: true, mode: 0o700 });
    return await mkdtemp(path.join(scratchBase, prefix));
  } catch {
    return await mkdtemp(path.join(os.tmpdir(), prefix));
  }
}

const SERVER_SOURCE = `// Fake Orca upstream listener child. Explicitly NOT real Orca acceptance.
const http = require("node:http");
const server = http.createServer((req, res) => {
  if (process.send) process.send({ type: "hit", hit: { url: req.url || "", host: req.headers.host || "" } });
  if ((req.url || "").split("?")[0] === "/web-index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Orca fixture</title>orca-fixture-upstream\\n");
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("upstream: no such path\\n");
});
server.listen(0, "127.0.0.1", () => {
  const a = server.address();
  if (process.send) process.send({ type: "listening", port: typeof a === "object" && a ? a.port : 0 });
});
function shutdown() {
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("message", (m) => { if (m === "close" || m?.type === "close") shutdown(); });
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
setInterval(() => {}, 1 << 30);
`;

/** Create the MSO-owned Orca root the readiness bridge verifies.
 *  The spawned child process itself creates and owns the HTTP upstream listener,
 *  reports its chosen port 0 over IPC, and records request hits (safe url/host only).
 *  The runtime-identity and status receipts record this exact child listener PID. */
export async function seedOrcaRuntime(root, options = {}) {
  const opts = typeof options === "object" && options !== null ? options : {};
  const binDir = path.join(root, "node", "bin");
  const releaseDir = path.join(root, "releases", ORCA_VERSION);
  const userData = path.join(root, "runtime", "user-data");
  await mkdir(binDir, { recursive: true, mode: 0o700 });
  await mkdir(releaseDir, { recursive: true, mode: 0o700 });
  await mkdir(userData, { recursive: true, mode: 0o700 });

  const nodeBinary = path.join(binDir, "node");
  const serverEntry = path.join(releaseDir, "orca-server.js");
  await copyFile(process.execPath, nodeBinary);
  await chmod(nodeBinary, 0o755);
  await writeFile(serverEntry, SERVER_SOURCE, { mode: 0o600 });

  const hits = [];
  const child = spawn(nodeBinary, [serverEntry], {
    stdio: ["ignore", "ignore", "ignore", "ipc"], env: { NODE_ENV: "test" },
  });

  let upstreamPort = 0;
  await new Promise((resolve, reject) => {
    child.on("message", (msg) => {
      if (typeof msg === "object" && msg !== null) {
        if (msg.type === "listening") { upstreamPort = Number(msg.port); resolve(upstreamPort); }
        else if (msg.type === "hit" && msg.hit) hits.push({ url: String(msg.hit.url), host: String(msg.hit.host) });
      }
    });
    child.once("error", reject);
    child.once("exit", (code, sig) => reject(new Error(`child exited before listening (code=${code}, sig=${sig})`)));
  });

  const pid = child.pid;
  let startTicks = "";
  for (let i = 0; i < 100 && !startTicks; i++) {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const rest = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
      if (rest[19] && /^\d+$/.test(rest[19])) startTicks = rest[19];
    } catch { /* waiting for proc stat */ }
    if (!startTicks) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!startTicks) throw new Error("could not read start ticks for fixture runtime process");

  const receiptPid = opts.wrongPid ? (typeof opts.wrongPid === "number" ? opts.wrongPid : pid + 999999) : pid;
  const receiptPort = opts.wrongPort ? (typeof opts.wrongPort === "number" ? opts.wrongPort : upstreamPort + 1) : upstreamPort;
  const pairingCode = Buffer.from(JSON.stringify({
    v: 2, scope: "runtime", endpoint: `wss://${APP_HOST}`,
    deviceToken: "fixture-device-token", publicKeyB64: "Zml4dHVyZS1rZXk",
  })).toString("base64url");
  const boundEndpoint = `ws://127.0.0.1:${receiptPort}`;

  await writeFile(path.join(root, "private-status.json"), JSON.stringify({
    type: "orca_server_ready", schemaVersion: 1, runtimeId: RUNTIME_ID,
    health: {
      buildVersion: ORCA_VERSION, nodeVersion: "24.21.0", nodeAbi: 137, pid: receiptPid,
      terminalDaemon: { state: "live", ownsFreshSessions: true, selfTest: { ok: true } },
    },
    boundEndpoint, advertisedEndpoint: `wss://${APP_HOST}`,
    pairing: { available: true, scope: "runtime", url: `orca://pair#${pairingCode}` },
  }), { mode: 0o600 });

  await writeFile(path.join(root, "runtime-identity.json"), JSON.stringify({
    schemaVersion: 1, runtimeId: RUNTIME_ID, version: ORCA_VERSION,
    serverPid: receiptPid, serverStartTicks: startTicks,
    nodeBinary, serverEntry, userData, boundEndpoint, advertisedEndpoint: `wss://${APP_HOST}`, readyAt: new Date().toISOString(),
  }), { mode: 0o600 });

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    if (child.exitCode === null && child.signalCode === null) {
      const exitPromise = once(child, "exit");
      try { if (child.connected) child.send("close"); else child.kill("SIGTERM"); } catch { child.kill("SIGTERM"); }
      const killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* safe */ } }, 2000);
      killTimer.unref?.();
      try { await exitPromise; } finally { clearTimeout(killTimer); }
    }
  };

  return { pid, port: upstreamPort, url: `http://127.0.0.1:${upstreamPort}`, hits, close, kill: close };
}

/** Backward-compatible alias for starting fake Orca upstream fixture. */
export async function startOrcaUpstream(existingRoot) {
  const root = existingRoot ?? await createFixtureDirectory("mso-orca-upstream-");
  return seedOrcaRuntime(root);
}

/** Emit bounded, credential-free response metadata and retain the redacted server
 *  log at an explicit private path, BEFORE an assertion fires, so a non-200 is
 *  diagnosable without leaking cookies/tickets/pairing codes. */
export function createDiagnostics({ file, getPhase, hits, getLog }) {
  return function dump(label, res) {
    const safe = {
      phase: getPhase(), label, status: res.status,
      headerNames: Object.keys(res.headers).sort(),
      body: redact(res.text).slice(0, 400),
      upstreamHits: hits.length,
      upstreamHosts: hits.slice(-5).map((hit) => hit.host),
    };
    const log = redact(getLog()).slice(-4000);
    try { writeFileSync(file, `phase=${getPhase()}\n${JSON.stringify(safe, null, 2)}\n--- mso server log (redacted, tail) ---\n${log}\n`, { mode: 0o600 }); } catch { /* diagnostics are best-effort */ }
    console.error("DIAG " + label + " " + JSON.stringify(safe));
    console.error("DIAG mso server log (redacted, tail):\n" + log);
  };
}
