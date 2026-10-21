import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE = "{id}.mso.example.com";
  process.env.OS_PUBLIC_ORIGIN = "https://mso.example.com";
});

import { chmod, copyFile, link, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer, type Server as NetServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { getOrcaReadiness } from "./orca-readiness";
import { readLinuxProcessSnapshot } from "./orca-process-identity";

function pairingUrl(): string {
  const payload = { v: 2, endpoint: "wss://orca.mso.example.com", deviceToken: "dev_tok_12345", publicKeyB64: "pub_key_12345", scope: "runtime" };
  return `orca://pair?code=${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

function statusPayload(pid: number, port: number): Record<string, unknown> {
  return {
    type: "orca_server_ready",
    schemaVersion: 1,
    runtimeId: "rt_listener_binding",
    boundEndpoint: `ws://127.0.0.1:${port}`,
    advertisedEndpoint: "wss://orca.mso.example.com",
    pairing: { available: true, scope: "runtime", url: pairingUrl() },
    health: {
      buildVersion: "1.4.230",
      nodeVersion: "24.21.0",
      nodeAbi: "137",
      pid,
      terminalDaemon: { state: "live", ownsFreshSessions: true, selfTest: { ok: true, verdict: "healthy" } },
    },
  };
}

describe("getOrcaReadiness binds the verified runtime to its LISTEN socket", () => {
  const roots: string[] = [];
  const children: ChildProcess[] = [];
  const servers: NetServer[] = [];
  afterAll(async () => {
    for (const child of children) { try { child.kill("SIGKILL"); } catch { /* already gone */ } }
    for (const server of servers) await new Promise<void>((resolve) => server.close(() => resolve()));
    while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
  });

  async function freePort(): Promise<number> {
    const probe = createNetServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return port;
  }

  it("accepts an owned fixture listener and denies after a live port takeover", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mso-orca-ready-"));
    roots.push(root);
    await chmod(root, 0o700);
    const release = path.join(root, "releases", "1.4.230");
    const nodeBin = path.join(root, "runtimes", "node-24.21.0", "bin");
    const userData = path.join(root, "runtime", "user-data");
    await mkdir(release, { recursive: true, mode: 0o700 });
    await mkdir(nodeBin, { recursive: true, mode: 0o700 });
    await mkdir(userData, { recursive: true, mode: 0o700 });
    const nodePath = path.join(nodeBin, "node");
    try { await link(process.execPath, nodePath); } catch { await copyFile(process.execPath, nodePath); }
    await chmod(nodePath, 0o755);
    const nodeBinary = await realpath(nodePath);
    const serverEntry = path.join(release, "orcad-server.js");
    await writeFile(serverEntry, [
      "const net = require('node:net');",
      "const args = process.argv.slice(2);",
      "const port = Number(args[args.indexOf('--port') + 1]);",
      "const server = net.createServer((socket) => socket.end());",
      "server.listen(port, '127.0.0.1', () => process.send && process.send('listening'));",
      "process.on('message', (message) => { if (message === 'close') server.close(() => process.send && process.send('closed')); });",
      "setInterval(() => {}, 1 << 30);",
    ].join("\n"), { mode: 0o600 });

    const port = await freePort();
    const child = spawn(nodeBinary, [serverEntry, "--bind", "127.0.0.1", "--port", String(port), "--json"], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { NODE_ENV: "test" },
    });
    children.push(child);
    const pid = child.pid!;
    expect((await once(child, "message"))[0]).toBe("listening");
    const snap = await readLinuxProcessSnapshot(pid);
    expect(snap).not.toBeNull();
    await writeFile(path.join(root, "private-status.json"), JSON.stringify(statusPayload(pid, port)), { mode: 0o600 });
    await writeFile(path.join(root, "runtime-identity.json"), JSON.stringify({
      schemaVersion: 1,
      runtimeId: "rt_listener_binding",
      version: "1.4.230",
      serverPid: pid,
      serverStartTicks: snap!.startTicks,
      nodeBinary,
      serverEntry,
      userData,
      boundEndpoint: `ws://127.0.0.1:${port}`,
      advertisedEndpoint: "wss://orca.mso.example.com",
      readyAt: new Date().toISOString(),
    }), { mode: 0o600 });
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", ORCA_HOME: root, ORCA_DASHBOARD_URL: `http://127.0.0.1:${port}` };

    const ready = await getOrcaReadiness({ env });
    expect(ready.available).toBe(true);
    if (ready.available) {
      expect(ready.serverPid).toBe(pid);
      expect(ready.startTicks).toBe(snap!.startTicks);
      expect(ready.boundEndpoint).toBe(`ws://127.0.0.1:${port}`);
    }

    child.send("close");
    expect((await once(child, "message"))[0]).toBe("closed");
    const taker = createNetServer((socket) => socket.end());
    servers.push(taker);
    await new Promise<void>((resolve) => taker.listen(port, "127.0.0.1", resolve));
    expect(() => process.kill(pid, 0)).not.toThrow();
    await expect(getOrcaReadiness({ env })).resolves.toMatchObject({
      available: false,
      reason: "listener_not_owned_by_process",
    });
  }, 10_000);
});
