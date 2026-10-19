// Synthetic, loopback-only harness for the managed-app internal-rewrite regression.
//
// Nothing here touches owner state, services, DNS, or real credentials: a fake Orca
// upstream plus an owner-only Orca managed root (status + runtime-identity files and
// a real owned `node` process so the readiness bridge can verify process identity).
// The fake upstream proves the server-side rewrite reaches the upstream instead of
// self-hopping; it is NOT evidence of E2E Orca/browser acceptance.
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
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

/** Fake Orca dashboard upstream (what ORCA_DASHBOARD_URL points at). Records every hit
 *  so the regression can prove the rewrite was served by the upstream, not by a self-hop. */
export async function startOrcaUpstream() {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push({ url: req.url, host: req.headers.host ?? "" });
    if ((req.url ?? "").split("?")[0] === "/web-index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><title>Orca fixture</title>orca-fixture-upstream\n");
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("upstream: no such path\n");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    hits,
    port: server.address().port,
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Create the MSO-owned Orca root the readiness bridge verifies: owner-only files,
 *  a private copy of `node`, a live `node <serverEntry>` process, and a receipt that
 *  matches its kernel identity. */
export async function seedOrcaRuntime(root, upstreamPort) {
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
  await writeFile(serverEntry, "setInterval(() => {}, 1 << 30);\n", { mode: 0o600 });
  const child = spawn(nodeBinary, [serverEntry], { stdio: "ignore" });
  await once(child, "spawn");
  const pid = child.pid;
  let startTicks = "";
  for (let i = 0; i < 100 && !startTicks; i++) {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const rest = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
      if (rest[19] && /^\d+$/.test(rest[19])) startTicks = rest[19];
    } catch { /* /proc/PID not ready yet */ }
    if (!startTicks) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!startTicks) throw new Error("could not read start ticks for the fixture runtime process");

  const pairingCode = Buffer.from(JSON.stringify({
    v: 2, scope: "runtime", endpoint: `wss://${APP_HOST}`,
    deviceToken: "fixture-device-token", publicKeyB64: "Zml4dHVyZS1rZXk",
  })).toString("base64url");
  const boundEndpoint = `ws://127.0.0.1:${upstreamPort}`;
  await writeFile(path.join(root, "private-status.json"), JSON.stringify({
    type: "orca_server_ready", schemaVersion: 1, runtimeId: RUNTIME_ID,
    health: {
      buildVersion: ORCA_VERSION, nodeVersion: "24.21.0", nodeAbi: 137, pid,
      terminalDaemon: { state: "live", ownsFreshSessions: true, selfTest: { ok: true } },
    },
    boundEndpoint, advertisedEndpoint: `wss://${APP_HOST}`,
    pairing: { available: true, scope: "runtime", url: `orca://pair#${pairingCode}` },
  }), { mode: 0o600 });
  await writeFile(path.join(root, "runtime-identity.json"), JSON.stringify({
    schemaVersion: 1, runtimeId: RUNTIME_ID, version: ORCA_VERSION,
    serverPid: pid, serverStartTicks: startTicks,
    nodeBinary, serverEntry, userData,
    boundEndpoint, advertisedEndpoint: `wss://${APP_HOST}`, readyAt: new Date().toISOString(),
  }), { mode: 0o600 });
  return { pid, kill: () => child.kill("SIGKILL") };
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
