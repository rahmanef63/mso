import { afterEach, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import { once } from "node:events";
import { attachSocketProxy } from "../../scripts/server-sockets.mjs";

const servers: Server[] = [], sockets: Socket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});
async function listen(server: Server) {
  servers.push(server); server.listen(0, "127.0.0.1"); await once(server, "listening");
  return (server.address() as { port: number }).port;
}

it("stops both forwarding directions and closes idle sockets when live authority disappears", async () => {
  const seen: string[] = [];
  const upstream = createServer();
  let remote: Socket | undefined;
  upstream.on("upgrade", (_request, socket) => {
    remote = socket as Socket; sockets.push(remote);
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    socket.on("data", (chunk) => { seen.push(chunk.toString()); socket.write(chunk); });
  });
  const upstreamPort = await listen(upstream);
  let allowed = true;
  const proxy = createServer();
  attachSocketProxy(proxy, async () => allowed ? { identity: "device", target: `http://127.0.0.1:${upstreamPort}/socket`, headers: { upgrade: "websocket", connection: "Upgrade" } } : null);
  const proxyPort = await listen(proxy);
  const client = connect(proxyPort, "127.0.0.1"); sockets.push(client);
  const handshake = once(client, "data");
  client.write("GET /socket HTTP/1.1\r\nHost: app.test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
  expect((await handshake)[0].toString()).toContain("101 Switching Protocols");
  const echo = once(client, "data"); client.write("permitted"); await echo;
  expect(seen).toEqual(["permitted"]);
  allowed = false;
  const closed = once(client, "close"); remote!.write("private-output-after-revoke");
  await closed;
  expect(seen).toEqual(["permitted"]);

  allowed = true;
  const idle = connect(proxyPort, "127.0.0.1"); sockets.push(idle);
  const ready = once(idle, "data"); idle.write("GET /socket HTTP/1.1\r\nHost: app.test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n"); await ready;
  allowed = false;
  await once(idle, "close");
}, 5000);
