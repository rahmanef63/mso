import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createNetServer, type Server as NetServer } from "node:net";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { readLinuxProcessSnapshot, type OrcaProcessSnapshot } from "./orca-process-identity";
import {
  numericLoopbackAddress,
  parseProcNetListeners,
  verifyOrcaListenerBinding,
  type OrcaListenerCandidate,
  type OrcaListenerBindingDeps,
} from "./orca-runtime-binding";

const V4_ROW = "   0: 0100007F:1A71 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 12345 1 0000000000000000 100 0 0 10 0";
const V6_ROW = "   0: 00000000000000000000000001000000:1A71 00000000000000000000000000000000:0000 0A 00000000000000000000000000000000:00000000 00:00000000 00000000 1000 0 67890 1 0000000000000000 100 0 0 10 0";

function snapshot(over: Partial<OrcaProcessSnapshot> = {}): OrcaProcessSnapshot {
  return { pid: 77, startTicks: "100", uid: 1000, exe: "/owned/node", argv: ["/owned/node", "/owned/server.js"], ...over };
}

describe("proc/net listener parsing", () => {
  it("decodes exact IPv4 and IPv6 LISTEN rows and ignores non-listeners", () => {
    expect(parseProcNetListeners(`header\n${V4_ROW}`, "ipv4")).toEqual([
      { family: "ipv4", address: "127.0.0.1", port: 6769, inode: "12345" },
    ]);
    expect(parseProcNetListeners(`header\n${V6_ROW}`, "ipv6")).toEqual([
      { family: "ipv6", address: "::1", port: 6769, inode: "67890" },
    ]);
    expect(parseProcNetListeners(`header\n${V4_ROW.replace(" 0A ", " 01 ")}`, "ipv4")).toEqual([]);
    expect(parseProcNetListeners(`header\n${V4_ROW.replace(":1A71 ", ":1A70 ")}`, "ipv4")).toEqual([
      { family: "ipv4", address: "127.0.0.1", port: 6768, inode: "12345" },
    ]);
  });

  it("accepts only literal numeric loopback hosts, never DNS fallback", () => {
    expect(numericLoopbackAddress("127.0.0.1")).toBe("127.0.0.1");
    expect(numericLoopbackAddress("[::1]")).toBe("::1");
    expect(numericLoopbackAddress("localhost")).toBeNull();
    expect(numericLoopbackAddress("0.0.0.0")).toBeNull();
    expect(numericLoopbackAddress("::")).toBeNull();
  });
});

describe("verifyOrcaListenerBinding fail-closed decisions", () => {
  const listeners = (over: Partial<OrcaListenerCandidate>[] = []): OrcaListenerCandidate[] => [
    { family: "ipv4", address: "127.0.0.1", port: 6769, inode: "12345", ...over[0] },
  ];
  const deps = (over: Partial<OrcaListenerBindingDeps> = {}): OrcaListenerBindingDeps => ({
    platform: "linux",
    readProcess: async () => snapshot(),
    readListeners: async () => listeners(),
    readSocketInodes: async () => new Set(["12345"]),
    ...over,
  });
  const input = { pid: 77, startTicks: "100", host: "127.0.0.1", port: 6769 };

  it("binds the exact LISTEN inode to the owned process", async () => {
    await expect(verifyOrcaListenerBinding(input, deps())).resolves.toMatchObject({
      ok: true,
      binding: { address: "127.0.0.1", port: 6769, inode: "12345" },
    });
  });

  it("denies unsupported platforms, unreadable tables/fds, and non-numeric hosts", async () => {
    const platform = await verifyOrcaListenerBinding(input, deps({ platform: "darwin" }));
    expect(platform).toMatchObject({ ok: false, reason: "listener_proof_unsupported_platform" });
    const table = await verifyOrcaListenerBinding(input, deps({ readListeners: async () => null }));
    expect(table).toMatchObject({ ok: false, reason: "listener_table_unreadable" });
    const fds = await verifyOrcaListenerBinding(input, deps({ readSocketInodes: async () => null }));
    expect(fds).toMatchObject({ ok: false, reason: "process_socket_fds_unreadable" });
    const named = await verifyOrcaListenerBinding({ ...input, host: "localhost" }, deps());
    expect(named).toMatchObject({ ok: false, reason: "listener_host_not_numeric_loopback" });
  });

  it("denies a port owned by another process, an ambiguous listener, or a changed PID", async () => {
    const foreign = await verifyOrcaListenerBinding(input, deps({ readSocketInodes: async () => new Set(["999"]) }));
    expect(foreign).toMatchObject({ ok: false, reason: "listener_not_owned_by_process" });
    const ambiguous = await verifyOrcaListenerBinding(input, deps({
      readListeners: async () => [...listeners(), { family: "ipv4", address: "127.0.0.1", port: 6769, inode: "22222" }],
    }));
    expect(ambiguous).toMatchObject({ ok: false, reason: "listener_ambiguous" });
    const changed = await verifyOrcaListenerBinding(input, deps({ readProcess: async () => snapshot({ startTicks: "101" }) }));
    expect(changed).toMatchObject({ ok: false, reason: "listener_process_changed" });
    let call = 0;
    const swapped = await verifyOrcaListenerBinding(input, deps({
      readListeners: async () => listeners([{ inode: call++ === 0 ? "12345" : "33333" }]),
    }));
    expect(swapped).toMatchObject({ ok: false, reason: "listener_changed" });
  });
});

describe("actual task-fixture listener ownership", () => {
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

  it("proves the owned PID owns the LISTEN inode, and rejects a live port takeover", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mso-orca-bind-"));
    roots.push(dir);
    const script = path.join(dir, "holder.js");
    await writeFile(script, [
      "const net = require('node:net');",
      "const port = Number(process.argv[2]);",
      "const server = net.createServer((socket) => socket.end());",
      "server.listen(port, '127.0.0.1', () => process.send && process.send('listening'));",
      "process.on('message', (message) => { if (message === 'close') server.close(() => process.send && process.send('closed')); });",
      "setInterval(() => {}, 1 << 30);",
    ].join("\n"), { mode: 0o600 });
    await chmod(script, 0o600);
    const port = await freePort();
    const child = spawn(process.execPath, [script, String(port)], { stdio: ["ignore", "ignore", "ignore", "ipc"], env: { NODE_ENV: "test" } });
    children.push(child);
    const pid = child.pid!;
    expect((await once(child, "message"))[0]).toBe("listening");
    const snap = await readLinuxProcessSnapshot(pid);
    expect(snap).not.toBeNull();

    const first = await verifyOrcaListenerBinding({ pid, startTicks: snap!.startTicks, host: "127.0.0.1", port });
    expect(first).toMatchObject({ ok: true, binding: { address: "127.0.0.1", port } });

    child.send("close");
    expect((await once(child, "message"))[0]).toBe("closed");
    const taker = createNetServer((socket) => socket.end());
    servers.push(taker);
    await new Promise<void>((resolve) => taker.listen(port, "127.0.0.1", resolve));
    expect(() => process.kill(pid, 0)).not.toThrow();
    await expect(verifyOrcaListenerBinding({ pid, startTicks: snap!.startTicks, host: "127.0.0.1", port }))
      .resolves.toMatchObject({ ok: false, reason: "listener_not_owned_by_process" });
  });
});
