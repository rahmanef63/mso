import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect } from "node:net";
import { once } from "node:events";
import { releaseFixture } from "./release-fixture.mjs";

const sockets = new Set();
const upstream = createServer();
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
  fixture = await releaseFixture();
  const response = await fetch(fixture.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: fixture.base }, body: JSON.stringify({ password: fixture.password, deviceId: fixture.device }) });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(fixture.base + "/api/internal/socket-policy", { method: "POST" })).status, 404);
  async function open() {
    const client = connect(Number(new URL(fixture.base).port), "127.0.0.1"); sockets.add(client);
    client.on("error", () => {});
    const first = Promise.race([once(client, "data").then(([data]) => data.toString()), once(client, "close").then(() => "")]);
    client.write(`GET /socket HTTP/1.1\r\nHost: hermes.mso.example.com\r\nOrigin: http://hermes.mso.example.com\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nCookie: ${cookie}\r\nAuthorization: must-not-forward\r\n\r\n`);
    return { client, handshake: await first };
  }
  const { client, handshake } = await open(); assert.match(handshake, /101 Switching Protocols/);
  const echo = once(client, "data"); client.write("permitted"); assert.equal((await echo)[0].toString(), "permitted");
  let delivered = ""; client.on("data", (chunk) => { delivered += chunk.toString(); });
  const closed = once(client, "close"); await fixture.setRole("viewer"); remote.write("private-after-demotion"); await closed;
  assert.equal(delivered, "");
  await fixture.setRole("owner");
  const idle = await open(); assert.match(idle.handshake, /101 Switching Protocols/);
  const idleClosed = once(idle.client, "close");
  assert.equal((await fetch(fixture.base + "/api/auth/logout", { method: "POST", headers: { cookie, origin: fixture.base } })).status, 200);
  await idleClosed;
  assert.doesNotMatch((await open()).handshake, /101/);
  console.log("PASS production socket authority: real login/policy RPC, cookie stripping, live demotion, idle logout and replay refusal");
} finally {
  for (const socket of sockets) socket.destroy();
  await fixture?.close();
  await new Promise((resolve) => upstream.close(resolve));
  if (previous === undefined) delete process.env.HERMES_DASHBOARD_URL; else process.env.HERMES_DASHBOARD_URL = previous;
}
