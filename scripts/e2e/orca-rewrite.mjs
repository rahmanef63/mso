// Actual built-server regression for the managed-app internal rewrite origin.
//
// Root cause this pins (Next 16.3.8): a reverse proxy passes `Host: <app>` through
// while `x-forwarded-proto: https` makes Next describe its own plain-HTTP listener
// with a synthetic `https://localhost:PORT` nextUrl. The app-host branch used to
// downgrade that loopback scheme to `http:` before building the rewrite target, so
// the destination origin no longer equalled `initUrl`. Next classified the rewrite
// as EXTERNAL and self-hopped it over the network against the public Host, where
// middleware re-ran as a non-app host, stripped the managed-app marker, and 404'd.
//
// Everything here is synthetic and loopback-only: a fake Orca upstream plus an
// owner-only Orca managed root (status + runtime-identity files and a real owned
// `node` process so the readiness bridge can verify process identity). No owner
// state, services, DNS, or real credentials are touched. The fake upstream is not
// evidence of E2E Orca/browser acceptance — only that the server-side rewrite
// reaches the upstream instead of self-hopping.
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { releaseFixture } from "./release-fixture.mjs";

const COCKPIT = "https://cockpit.example.test";
const APP_HOST = "orca.mso.example.com";
const APP_ORIGIN = `https://${APP_HOST}`;
const ORCA_VERSION = "1.4.230";
const RUNTIME_ID = "fixture-orca-runtime";

// --- fake loopback upstream (what ORCA_DASHBOARD_URL points at) --------------
const hits = [];
const upstream = createServer((req, res) => {
  hits.push({ url: req.url, host: req.headers.host ?? "" });
  if ((req.url ?? "").split("?")[0] === "/web-index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Orca fixture</title>orca-fixture-upstream\n");
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("upstream: no such path\n");
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const upstreamPort = upstream.address().port;

const pairingCode = Buffer.from(JSON.stringify({
  v: 2, scope: "runtime", endpoint: `wss://${APP_HOST}`,
  deviceToken: "fixture-device-token", publicKeyB64: "Zml4dHVyZS1rZXk",
})).toString("base64url");

/** Create the MSO-owned Orca root the readiness bridge verifies: owner-only files,
 *  a private copy of `node`, a live `node <serverEntry>` process, and a receipt that
 *  matches its kernel identity. */
async function seedOrcaRuntime(root) {
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

const orcaRoot = await mkdtemp(path.join(os.tmpdir(), "mso-orca-rewrite-fixture-"));
process.env.ORCA_HOME = orcaRoot;
process.env.ORCA_DASHBOARD_URL = `http://127.0.0.1:${upstreamPort}`;
let runtime;
let fixture;

/** Raw HTTP hop to the fixture server with an explicit Host header (fetch cannot set it). */
const hop = (pathname, { host, headers = {}, method = "GET" } = {}) =>
  new Promise((resolve, reject) => {
    const req = request(fixture.base + pathname, { method, headers: { host, ...headers } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.once("error", reject);
    req.end();
  });

try {
  runtime = await seedOrcaRuntime(orcaRoot);
  fixture = await releaseFixture({ publicOrigin: COCKPIT });

  const login = await fetch(fixture.base + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json", origin: fixture.base },
    body: JSON.stringify({ password: fixture.password, deviceId: fixture.device }),
  });
  assert.equal(login.status, 200, "owner login must succeed");
  const sessionCookie = login.headers.get("set-cookie").split(";")[0];

  const session = await fetch(fixture.base + "/api/v1/managed-apps/orca/session", { headers: { cookie: sessionCookie } });
  assert.equal(session.status, 200, "orca session ticket must be issued from the synthetic readiness root");
  const { ticket, origin } = await session.json();
  assert.equal(origin, APP_ORIGIN, "the ticket is bound to the orca split origin");

  const grant = await hop("/__mso_app_auth", {
    host: APP_HOST, method: "POST",
    headers: { origin: APP_ORIGIN, authorization: `Bearer ${ticket}`, "x-forwarded-proto": "https" },
  });
  assert.equal(grant.status, 204, "legit ticket exchange mints the app cookie");
  const appCookie = (grant.headers["set-cookie"] ?? [])[0]?.split(";")[0] ?? "";
  assert.match(appCookie, /^__Host-mso-managed-app=/);

  // THE REGRESSION: forwarded HTTPS to the app host must reach the real upstream.
  const httpsIndex = await hop("/web-index.html?tab=1", {
    host: APP_HOST, headers: { cookie: appCookie, "x-forwarded-proto": "https" },
  });
  assert.equal(httpsIndex.status, 200, "forwarded-HTTPS app-host fetch must reach the upstream, not self-hop to a 404");
  assert.equal(httpsIndex.headers["x-managed-app"], "orca");
  assert.match(httpsIndex.text, /orca-fixture-upstream/);

  // HTTP control: no x-forwarded-proto, so nextUrl's origin is the real http loopback.
  const httpIndex = await hop("/web-index.html", { host: APP_HOST, headers: { cookie: appCookie } });
  assert.equal(httpIndex.status, 200, "the HTTP control still reaches the upstream");
  assert.match(httpIndex.text, /orca-fixture-upstream/);
  assert.equal(httpIndex.headers["x-managed-app"], "orca");

  // Unauthenticated forwarded-HTTPS still reaches the gate (not a rewrite 404).
  const unauthed = await hop("/web-index.html", { host: APP_HOST, headers: { "x-forwarded-proto": "https" } });
  assert.equal(unauthed.status, 401, "unauthenticated app-host fetch is 401");
  assert.doesNotMatch(unauthed.text, /orca-fixture-upstream/);

  // The iframe/document bootstrap shell is served, but never upstream bytes.
  const bootstrap = await hop("/web-index.html", {
    host: APP_HOST, headers: { "x-forwarded-proto": "https", "sec-fetch-dest": "iframe" },
  });
  assert.equal(bootstrap.status, 200, "the unauthenticated bootstrap shell is served");
  assert.match(bootstrap.text, /__mso_app_bootstrap\.js/);
  assert.doesNotMatch(bootstrap.text, /orca-fixture-upstream/);

  // A forged marker on the COCKPIT origin must not reopen the same-origin hole.
  const forged = await hop("/api/v1/managed-apps/orca/proxy/web-index.html", {
    host: new URL(COCKPIT).host, headers: { "x-os-managed-app-host": "orca", cookie: appCookie },
  });
  assert.equal(forged.status, 404, "a forged marker on the cockpit origin must 404");

  // Every upstream byte was fetched directly on loopback, never via the public Host.
  assert.equal(hits.length, 2, "the upstream is fetched once per authenticated app-host request");
  assert.ok(hits.every((hit) => /^127\.0\.0\.1:/.test(hit.host)), "upstream Host is loopback");

  console.log("orca-rewrite: PASS " + JSON.stringify({
    https: httpsIndex.status, http: httpIndex.status, unauthed: unauthed.status,
    bootstrap: bootstrap.status, forged: forged.status, upstreamHits: hits.length,
  }));
} finally {
  if (fixture) await fixture.close();
  runtime?.kill();
  upstream.closeAllConnections?.();
  await new Promise((resolve) => upstream.close(resolve));
  await rm(orcaRoot, { recursive: true, force: true });
}
