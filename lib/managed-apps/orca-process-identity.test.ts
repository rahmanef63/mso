import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  parseOrcaRuntimeReceipt,
  parseProcStatStartTicks,
  readLinuxProcessSnapshot,
  receiptPathsAreContained,
  verifyOrcaProcessIdentity,
  type OrcaProcessSnapshot,
  type OrcaRuntimeReceipt,
} from "./orca-process-identity";

const root = "/home/owner/.local/share/mso/orca";
const validReceipt: OrcaRuntimeReceipt = {
  schemaVersion: 1,
  runtimeId: "rt_abcd1234",
  version: "1.4.230",
  serverPid: 4242,
  serverStartTicks: "99887766",
  nodeBinary: `${root}/runtimes/node-24.21.0/bin/node`,
  serverEntry: `${root}/releases/1.4.230-abcd/orcad-server.js`,
  userData: `${root}/runtime/user-data`,
  boundEndpoint: "ws://127.0.0.1:6769",
  advertisedEndpoint: "wss://orca.mso.example.com",
  readyAt: "2026-10-19T10:00:00.000Z",
};

function snapshot(over: Partial<OrcaProcessSnapshot> = {}): OrcaProcessSnapshot {
  return {
    pid: 4242,
    startTicks: "99887766",
    uid: typeof process.getuid === "function" ? process.getuid() : 1000,
    exe: validReceipt.nodeBinary,
    argv: [validReceipt.nodeBinary, validReceipt.serverEntry, "--bind", "127.0.0.1", "--port", "6769", "--json"],
    ...over,
  };
}

describe("parseProcStatStartTicks", () => {
  it("parses field 22 even when comm contains spaces and parentheses", () => {
    const rest = ["S", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "424242"];
    const stat = `123 (node (weird ) name) ${rest.join(" ")}`;
    expect(parseProcStatStartTicks(stat)).toBe("424242");
    expect(parseProcStatStartTicks("not a stat line")).toBeNull();
    expect(parseProcStatStartTicks("1 (x) S 1")).toBeNull();
  });
});

describe("readLinuxProcessSnapshot", () => {
  it("reads the current process identity from /proc without environ", async () => {
    const snap = await readLinuxProcessSnapshot(process.pid);
    expect(snap).not.toBeNull();
    expect(snap?.pid).toBe(process.pid);
    expect(snap?.startTicks).toMatch(/^\d+$/);
    expect(snap?.exe.length).toBeGreaterThan(0);
    expect(snap?.argv.length).toBeGreaterThan(0);
    if (typeof process.getuid === "function") expect(snap?.uid).toBe(process.getuid());
  });

  it("returns null (deny, not bless) for system/dead/foreign PIDs", async () => {
    expect(await readLinuxProcessSnapshot(1)).toBeNull();
    expect(await readLinuxProcessSnapshot(0)).toBeNull();
    expect(await readLinuxProcessSnapshot(99999999)).toBeNull();
  });
});

describe("parseOrcaRuntimeReceipt", () => {
  it("accepts an exact schema-1 receipt", () => {
    expect(parseOrcaRuntimeReceipt(JSON.stringify(validReceipt))).toEqual(validReceipt);
  });

  it("rejects missing, wrong-version, relative-path, and non-decimal-start receipts", () => {
    expect(parseOrcaRuntimeReceipt("not json")).toBeNull();
    expect(parseOrcaRuntimeReceipt(JSON.stringify({ ...validReceipt, schemaVersion: 2 }))).toBeNull();
    expect(parseOrcaRuntimeReceipt(JSON.stringify({ ...validReceipt, version: "1.4.229" }))).toBeNull();
    expect(parseOrcaRuntimeReceipt(JSON.stringify({ ...validReceipt, serverPid: 0 }))).toBeNull();
    expect(parseOrcaRuntimeReceipt(JSON.stringify({ ...validReceipt, serverStartTicks: "abc" }))).toBeNull();
    expect(parseOrcaRuntimeReceipt(JSON.stringify({ ...validReceipt, serverEntry: "relative.js" }))).toBeNull();
    expect(parseOrcaRuntimeReceipt(JSON.stringify({ ...validReceipt, nodeBinary: undefined }))).toBeNull();
    expect(parseOrcaRuntimeReceipt(JSON.stringify({ ...validReceipt, runtimeId: "" }))).toBeNull();
  });
});

describe("receipt containment and process identity", () => {
  it("enforces root/profile/release containment", () => {
    expect(receiptPathsAreContained(validReceipt, root)).toBe(true);
    expect(receiptPathsAreContained({ ...validReceipt, serverEntry: "/tmp/orcad-server.js" }, root)).toBe(false);
    expect(receiptPathsAreContained({ ...validReceipt, serverEntry: `${root}/other/orcad-server.js` }, root)).toBe(false);
    expect(receiptPathsAreContained({ ...validReceipt, userData: `${root}/runtime/other` }, root)).toBe(false);
    expect(receiptPathsAreContained({ ...validReceipt, nodeBinary: "/usr/bin/node" }, root)).toBe(false);
  });

  it("requires the actual owned process to match exactly", () => {
    expect(verifyOrcaProcessIdentity(validReceipt, snapshot(), root)).toBe(true);
    expect(verifyOrcaProcessIdentity(validReceipt, null, root)).toBe(false);
    expect(verifyOrcaProcessIdentity(validReceipt, snapshot({ pid: 999 }), root)).toBe(false);
    expect(verifyOrcaProcessIdentity(validReceipt, snapshot({ startTicks: "1" }), root)).toBe(false);
    expect(verifyOrcaProcessIdentity(validReceipt, snapshot({ uid: 0 }), root)).toBe(false);
    expect(verifyOrcaProcessIdentity(validReceipt, snapshot({ exe: "/usr/bin/node" }), root)).toBe(false);
    expect(verifyOrcaProcessIdentity(validReceipt, snapshot({ argv: ["/usr/bin/node", "other.js"] }), root)).toBe(false);
  });
});

describe("actual disposable same-task node process", () => {
  const tmpRoots: string[] = [];
  const children: ReturnType<typeof spawn>[] = [];
  afterAll(async () => {
    for (const child of children) { try { child.kill("SIGKILL"); } catch { /* ignore */ } }
    while (tmpRoots.length) await rm(tmpRoots.pop()!, { recursive: true, force: true });
  });

  it("verifies a real node process spawned from the pinned shape", async () => {
    const managed = await mkdtemp(path.join(os.tmpdir(), "mso-orca-proc-"));
    tmpRoots.push(managed);
    const releases = path.join(managed, "releases", "slot");
    const runtime = path.join(managed, "runtime");
    await mkdir(releases, { recursive: true, mode: 0o700 });
    await mkdir(path.join(runtime, "user-data"), { recursive: true, mode: 0o700 });
    const entry = path.join(releases, "orcad-server.js");
    await writeFile(entry, "setTimeout(()=>{}, 30000);", { mode: 0o600 });
    // The pinned node runtime lives inside the managed root; place a real executable
    // there (hardlink, else copy) so the receipt's containment and exe match hold.
    const nodeDir = path.join(managed, "runtimes", "node-24.21.0", "bin");
    await mkdir(nodeDir, { recursive: true, mode: 0o700 });
    const nodePath = path.join(nodeDir, "node");
    try {
      await import("node:fs").then((fs) => fs.promises.link(process.execPath, nodePath));
    } catch {
      await import("node:fs").then((fs) => fs.promises.copyFile(process.execPath, nodePath));
    }
    const exe = await import("node:fs").then((fs) => fs.promises.realpath(nodePath));

    const child = spawn(exe, [entry, "--bind", "127.0.0.1", "--port", "6769", "--json"], { stdio: "ignore" });
    children.push(child);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const snap = await readLinuxProcessSnapshot(child.pid!);
    expect(snap).not.toBeNull();
    const receipt: OrcaRuntimeReceipt = {
      ...validReceipt,
      serverPid: child.pid!,
      serverStartTicks: snap!.startTicks,
      nodeBinary: exe,
      serverEntry: entry,
      userData: path.join(runtime, "user-data"),
    };
    expect(receiptPathsAreContained(receipt, managed)).toBe(true);
    expect(verifyOrcaProcessIdentity(receipt, snap, managed)).toBe(true);
  });
});
