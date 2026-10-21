import { afterAll, afterEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { attachSocketProxy } from "../../scripts/server-sockets.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "mso-orca-socket-"));
process.env.OS_DEVICE_STORE = path.join(root, "devices.json");
process.env.OS_SESSION_SECRET = "s".repeat(32);
process.env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE = "{id}.mso.example.com";
process.env.OS_PUBLIC_ORIGIN = "https://mso.example.com";
const devices = await import("@/lib/auth/device-store");
const { socketPolicy } = await import("./socket-policy");
const { createManagedAppCookie } = await import("./session");

const servers: Server[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});
afterAll(async () => {
  for (const key of ["OS_DEVICE_STORE", "OS_SESSION_SECRET", "NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", "OS_PUBLIC_ORIGIN"]) delete process.env[key];
  await rm(root, { recursive: true, force: true });
});

async function listen(server: Server): Promise<number> {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as { port: number }).port;
}

it("revalidates the verified Orca runtime for every socket decision and closes on change", async () => {
  const id = "f".repeat(32);
  await devices.approveDevice(id, "operator", "operator");
  const issued = Date.now();
  const policy = await devices.currentSessionPolicy("host");
  const cookie = createManagedAppCookie("orca", {
    device_id: id,
    issued_at: issued,
    expires_at: issued + 60_000,
    cookie_scope: policy.scope,
    cookie_epoch: policy.epoch,
  }, process.env.OS_SESSION_SECRET!);

  const upstream = createServer();
  let remote: Socket | undefined;
  upstream.on("upgrade", (_request, socket) => {
    remote = socket as Socket;
    sockets.push(remote);
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    socket.on("data", (chunk) => socket.write(chunk));
  });
  const upstreamPort = await listen(upstream);
  const request = new NextRequest("https://orca.mso.example.com/socket?orca-client=web", {
    headers: {
      host: "orca.mso.example.com",
      origin: "https://orca.mso.example.com",
      upgrade: "websocket",
      connection: "Upgrade",
      cookie: `__Host-mso-managed-app=${cookie}`,
      authorization: "must-not-reach-upstream",
    },
  });
  let current: {
    available: true;
    runtimeId: string;
    serverPid: number;
    startTicks: string;
    listenerInode: string;
    boundEndpoint: string;
  } | { available: false; reason: string } = {
    available: true,
    runtimeId: "rt_fixture",
    serverPid: 4242,
    startTicks: "99887766",
    listenerInode: "11111",
    boundEndpoint: `ws://127.0.0.1:${upstreamPort}`,
  };
  const authorize = () => socketPolicy(request, { getOrcaReadiness: async () => current as never });

  const decision = await authorize();
  expect(decision?.identity).toBeDefined();
  expect(JSON.parse(decision!.identity!)).toMatchObject({
    device: id,
    runtimeId: "rt_fixture",
    serverPid: 4242,
    startTicks: "99887766",
    listenerInode: "11111",
  });
  expect(decision?.target).toBe(`http://127.0.0.1:${upstreamPort}/socket?orca-client=web`);
  expect(decision?.headers.cookie).toBeUndefined();
  expect(decision?.headers.authorization).toBeUndefined();

  const proxy = createServer();
  attachSocketProxy(proxy, authorize);
  const proxyPort = await listen(proxy);
  const client = connect(proxyPort, "127.0.0.1");
  sockets.push(client);
  const handshake = once(client, "data");
  client.write("GET /socket HTTP/1.1\r\nHost: orca.mso.example.com\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
  expect((await handshake)[0].toString()).toContain("101 Switching Protocols");
  const echo = once(client, "data");
  client.write("permitted");
  expect((await echo)[0].toString()).toBe("permitted");

  current = {
    available: true,
    runtimeId: "rt_replaced",
    serverPid: 4242,
    startTicks: "99887767",
    listenerInode: "22222",
    boundEndpoint: `ws://127.0.0.1:${upstreamPort}`,
  };
  const replaced = await authorize();
  expect(replaced).not.toBeNull();
  expect(replaced!.identity).not.toBe(decision!.identity);
  expect(replaced!.target).toBe(decision!.target);
  const closed = once(client, "close");
  remote!.write("runtime-changed");
  await closed;

  current = { available: false, reason: "listener_not_owned_by_process" };
  expect(await authorize()).toBeNull();
}, 5000);
