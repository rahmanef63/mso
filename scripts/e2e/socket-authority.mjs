import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { once } from "node:events";
import { releaseFixture } from "./release-fixture.mjs";

const sockets = new Set();
const upstream = createServer();
upstream.on("request", (request, response) => {
  assert.equal(request.headers.cookie, undefined); assert.equal(request.headers.authorization, undefined);
  response.writeHead(200, { "content-type": "text/plain" }); response.end("private editor");
});
let remote;
upstream.on("upgrade", (request, socket) => {
  assert.equal(request.headers.cookie, undefined);
  assert.equal(request.headers.authorization, undefined);
  remote = socket; sockets.add(socket);
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
  socket.on("data", (chunk) => socket.write(chunk));
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const previous = process.env.HERMES_DASHBOARD_URL;
process.env.HERMES_DASHBOARD_URL = `http://127.0.0.1:${upstream.address().port}`;
let fixture;
try {
  const native = { id: "fixture-editor", title: "Private editor", description: "", origin: "https://editor.cockpit.example.test", startPath: "/",
    renderer: "iframe", presentation: "inline", environment: "production", placements: ["shell"], sessionUpstream: process.env.HERMES_DASHBOARD_URL };
  fixture = await releaseFixture({ surfaceApps: [native], publicOrigin: "https://cockpit.example.test" });
  const response = await fetch(fixture.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: fixture.base }, body: JSON.stringify({ password: fixture.password, deviceId: fixture.device }) });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const ticketResponse = await fetch(fixture.base + "/api/v1/managed-apps/hermes/session", { headers: { cookie } });
  assert.equal(ticketResponse.status, 200);
  const authorization = await ticketResponse.json();
  // Node fetch ignores Host; use HTTP request to exercise the actual app-host gate.
  const exchange = await new Promise((resolve, reject) => {
    const hop = request(fixture.base + "/__mso_app_auth", { method: "POST", headers: { host: new URL(authorization.origin).host, origin: authorization.origin, authorization: "Bearer " + authorization.ticket } }, response => { response.resume(); resolve(response); });
    hop.once("error", reject); hop.end();
  });
  assert.equal(exchange.statusCode, 204);
  const appCookie = exchange.headers["set-cookie"][0].split(";")[0];
  assert.match(appCookie, /^__Host-mso-managed-app=/);
  assert.equal((await fetch(fixture.base + "/api/v1/exec/run", { method: "POST", headers: { cookie: appCookie, origin: fixture.base, "content-type": "application/json" }, body: JSON.stringify({ command: "true" }) })).status, 401);
  assert.equal((await fetch(fixture.base + "/api/internal/socket-policy", { method: "POST" })).status, 404);
  const nativeResponse = await fetch(fixture.base + `/api/v1/shell-apps/${native.id}/session`, { headers: { cookie } });
  assert.equal(nativeResponse.status, 200); const nativeAuthorization = await nativeResponse.json();
  const nativeExchange = await new Promise((resolve, reject) => {
    const hop = request(fixture.base + "/__mso_app_auth", { method: "POST", headers: { host: new URL(native.origin).host, origin: native.origin, authorization: "Bearer " + nativeAuthorization.ticket } }, response => { response.resume(); resolve(response); });
    hop.once("error", reject); hop.end();
  });
  assert.equal(nativeExchange.statusCode, 204);
  const nativeCookie = nativeExchange.headers["set-cookie"][0].split(";")[0]; assert.match(nativeCookie, /^__Host-mso-shell-app=/);
  assert.equal((await fetch(fixture.base + "/api/v1/shell-apps", { headers: { cookie: nativeCookie } })).status, 401);
  const nativeHttp = await new Promise((resolve, reject) => {
    const hop = request(fixture.base + "/private-note", { headers: { host: new URL(native.origin).host, cookie: nativeCookie + "; session=must-not-forward", authorization: "must-not-forward" } }, response => { let body = ""; response.on("data", data => { body += data; }); response.on("end", () => resolve({ status: response.statusCode, body })); });
    hop.once("error", reject); hop.end();
  });
  assert.deepEqual(nativeHttp, { status: 200, body: "private editor" });
  async function open(host = "hermes.mso.example.com", origin = "http://hermes.mso.example.com", credential = appCookie) {
    const client = connect(Number(new URL(fixture.base).port), "127.0.0.1"); sockets.add(client);
    client.on("error", () => {});
    const first = Promise.race([once(client, "data").then(([data]) => data.toString()), once(client, "close").then(() => "")]);
    client.write(`GET /socket HTTP/1.1\r\nHost: ${host}\r\nOrigin: ${origin}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nCookie: ${credential}\r\nAuthorization: must-not-forward\r\n\r\n`);
    return { client, handshake: await first };
  }
  const { client, handshake } = await open(); assert.match(handshake, /101 Switching Protocols/);
  const echo = once(client, "data"); client.write("permitted"); assert.equal((await echo)[0].toString(), "permitted");
  let delivered = ""; client.on("data", (chunk) => { delivered += chunk.toString(); });
  const closed = once(client, "close"); await fixture.setRole("viewer"); remote.write("private-after-demotion"); await closed;
  assert.equal(delivered, "");
  await fixture.setRole("owner");
  const idle = await open(); assert.match(idle.handshake, /101 Switching Protocols/);
  const nativeOpen = () => open(new URL(native.origin).host, native.origin, nativeCookie);
  const nativeActive = await nativeOpen(); assert.match(nativeActive.handshake, /101 Switching Protocols/);
  let nativeDelivered = ""; nativeActive.client.on("data", chunk => { nativeDelivered += chunk.toString(); });
  const nativeClosed = once(nativeActive.client, "close"); await fixture.setRole("operator"); remote.write("private-after-owner-demotion"); await nativeClosed;
  assert.equal(nativeDelivered, ""); assert.doesNotMatch((await nativeOpen()).handshake, /101/);
  await fixture.setRole("owner");
  const nativeIdle = await nativeOpen(); assert.match(nativeIdle.handshake, /101 Switching Protocols/);
  const nativeIdleClosed = once(nativeIdle.client, "close");
  const idleClosed = once(idle.client, "close");
  assert.equal((await fetch(fixture.base + "/api/auth/logout", { method: "POST", headers: { cookie, origin: fixture.base } })).status, 200);
  await idleClosed;
  await nativeIdleClosed; assert.doesNotMatch((await nativeOpen()).handshake, /101/);
  assert.doesNotMatch((await open()).handshake, /101/);
  console.log("PASS production socket authority: managed/connected app handoff, isolated HTTP, cookie stripping, live demotion, idle logout and replay refusal");
} finally {
  for (const socket of sockets) socket.destroy();
  await fixture?.close();
  await new Promise((resolve) => upstream.close(resolve));
  if (previous === undefined) delete process.env.HERMES_DASHBOARD_URL; else process.env.HERMES_DASHBOARD_URL = previous;
}
