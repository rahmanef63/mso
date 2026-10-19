// Actual built-server regression for the managed-app internal rewrite origin.
//
// Root cause this pins (Next 16.3.8): a reverse proxy passes `Host: <app>` through
// while `x-forwarded-proto: https` makes Next describe its own plain-HTTP listener
// with a synthetic `https://localhost:PORT` nextUrl. The app-host branch used to
// downgrade that loopback scheme to `http:` before building the rewrite target, so the
// destination origin no longer equalled `initUrl`. Next classified the rewrite as
// EXTERNAL and self-hopped it over the network against the public Host, where middleware
// re-ran as a non-host, stripped the managed-app marker, and 404'd (or 500'd over TLS).
//
// The engine computes `initUrl` from the launcher's hostname while its NextURL canonicalizes
// a bare loopback IP to `localhost`, so `scripts/server.mjs` must hand Next the canonical
// loopback name; the app-host branch must in turn rewrite to `request.nextUrl.origin`
// exactly. Both halves are exercised here. Harness (fake upstream child listener,
// synthetic readiness root, redacting diagnostics) lives in ./orca-rewrite-harness.mjs.
import assert from "node:assert/strict";
import { request } from "node:http";
import { rm } from "node:fs/promises";
import path from "node:path";
import { releaseFixture } from "./release-fixture.mjs";
import {
  APP_HOST,
  APP_ORIGIN,
  COCKPIT,
  createDiagnostics,
  createFixtureDirectory,
  seedOrcaRuntime,
} from "./orca-rewrite-harness.mjs";

const orcaRoot = await createFixtureDirectory("mso-orca-rewrite-fixture-");
// Diagnostics go to a private scratch dir, never into the worktree/repo tree.
const diagDir = await createFixtureDirectory("mso-orca-rewrite-diag-");
const diagFile = path.join(diagDir, "rewrite-diagnostics.log");

process.env.ORCA_HOME = orcaRoot;
const runtime = await seedOrcaRuntime(orcaRoot);
process.env.ORCA_DASHBOARD_URL = runtime.url;

let phase = "startup";
let serverLog = ""; // Bounded, redacted tail only.
let fixture;
let ok = false;

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

const dumpDiagnostics = createDiagnostics({
  file: diagFile, getPhase: () => phase, hits: runtime.hits, getLog: () => serverLog,
});

try {
  fixture = await releaseFixture({
    publicOrigin: COCKPIT,
    onLog: (stream, text) => { serverLog = (serverLog + `[${stream}] ${text}`).slice(-8000); },
  });
  phase = "login";

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
  phase = "https-index";
  const httpsIndex = await hop("/web-index.html?tab=1", {
    host: APP_HOST, headers: { cookie: appCookie, "x-forwarded-proto": "https" },
  });
  if (httpsIndex.status !== 200) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    dumpDiagnostics("forwarded-HTTPS app-host", httpsIndex);
  }
  assert.equal(httpsIndex.status, 200, "forwarded-HTTPS app-host fetch must reach the upstream, not self-hop");
  assert.equal(httpsIndex.headers["x-managed-app"], "orca");
  assert.match(httpsIndex.text, /orca-fixture-upstream/);

  // HTTP control: no x-forwarded-proto, so nextUrl's origin is the real http loopback.
  phase = "http-control";
  const httpIndex = await hop("/web-index.html", { host: APP_HOST, headers: { cookie: appCookie } });
  if (httpIndex.status !== 200) dumpDiagnostics("HTTP control app-host", httpIndex);
  assert.equal(httpIndex.status, 200, "the HTTP control still reaches the upstream");
  assert.match(httpIndex.text, /orca-fixture-upstream/);
  assert.equal(httpIndex.headers["x-managed-app"], "orca");

  // Unauthenticated forwarded-HTTPS still reaches the gate (not a rewrite 404).
  phase = "unauthed";
  const unauthed = await hop("/web-index.html", { host: APP_HOST, headers: { "x-forwarded-proto": "https" } });
  if (unauthed.status !== 401) dumpDiagnostics("unauthenticated app-host", unauthed);
  assert.equal(unauthed.status, 401, "unauthenticated app-host fetch is 401");
  assert.doesNotMatch(unauthed.text, /orca-fixture-upstream/);

  // The iframe/document bootstrap shell is served, but never upstream bytes.
  phase = "bootstrap";
  const bootstrap = await hop("/web-index.html", {
    host: APP_HOST, headers: { "x-forwarded-proto": "https", "sec-fetch-dest": "iframe" },
  });
  assert.equal(bootstrap.status, 200, "the unauthenticated bootstrap shell is served");
  assert.match(bootstrap.text, /__mso_app_bootstrap\.js/);
  assert.doesNotMatch(bootstrap.text, /orca-fixture-upstream/);

  // A forged marker on the COCKPIT origin must not reopen the same-origin hole.
  phase = "forged";
  const forged = await hop("/api/v1/managed-apps/orca/proxy/web-index.html", {
    host: new URL(COCKPIT).host, headers: { "x-os-managed-app-host": "orca", cookie: appCookie },
  });
  if (forged.status !== 404) dumpDiagnostics("forged cockpit marker", forged);
  assert.equal(forged.status, 404, "a forged marker on the cockpit origin must 404");

  // Every upstream byte was fetched directly on loopback, never via the public Host.
  assert.equal(runtime.hits.length, 2, "the upstream is fetched once per authenticated app-host request");
  assert.ok(runtime.hits.every((hit) => /^127\.0\.0\.1:/.test(hit.host)), "upstream Host is loopback");

  console.log("orca-rewrite: PASS " + JSON.stringify({
    https: httpsIndex.status, http: httpIndex.status, unauthed: unauthed.status,
    bootstrap: bootstrap.status, forged: forged.status, upstreamHits: runtime.hits.length,
  }));
  ok = true;
} finally {
  if (fixture) await fixture.close();
  if (runtime) await runtime.close();
  await rm(orcaRoot, { recursive: true, force: true });
  // Keep the redacted diagnostic when it matters; drop it on pass so runs stay clean.
  if (ok) await rm(diagDir, { recursive: true, force: true });
  else console.error(`orca-rewrite: diagnostic retained at ${diagFile}`);
}
