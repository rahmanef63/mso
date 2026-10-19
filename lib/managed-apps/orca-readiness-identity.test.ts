import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getOrcaReadiness, type OrcaReadinessDeps } from "./orca-readiness";
import { buildOrcaWebClientUrl } from "./orca-pairing";
import type { OrcaProcessReader, OrcaProcessSnapshot } from "./orca-process-identity";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE = "{id}.mso.example.com";
  process.env.OS_PUBLIC_ORIGIN = "https://mso.example.com";
  process.env.OS_SESSION_SECRET = "s".repeat(32);
});

const ORIGIN = "https://orca.mso.example.com";

function pairingUrl(): string {
  const payload = { v: 2, endpoint: "wss://orca.mso.example.com", deviceToken: "dev_tok_12345", publicKeyB64: "pub_key_12345", scope: "runtime" };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `orca://pair?code=${b64}`;
}

function statusPayload(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    type: "orca_server_ready",
    schemaVersion: 1,
    runtimeId: "rt_abcd1234efgh5678",
    boundEndpoint: "ws://127.0.0.1:6769",
    advertisedEndpoint: "wss://orca.mso.example.com",
    pairing: { available: true, scope: "runtime", url: pairingUrl() },
    health: {
      buildVersion: "1.4.230",
      nodeVersion: "24.21.0",
      nodeAbi: "137",
      pid: 4242,
      terminalDaemon: { state: "live", ownsFreshSessions: true, selfTest: { ok: true, verdict: "healthy" } },
    },
    ...overrides,
  };
}

describe("getOrcaReadiness filesystem and process identity gate", () => {
  let root: string;
  const snapshots = new Map<number, OrcaProcessSnapshot>();
  const reader: OrcaProcessReader = async (pid) => snapshots.get(pid) ?? null;
  const binding = async () => ({
    ok: true as const,
    binding: { family: "ipv4" as const, address: "127.0.0.1", port: 6769, inode: "424242" },
  });
  const deps = (over: OrcaReadinessDeps = {}): OrcaReadinessDeps => ({
    readProcess: reader,
    readBinding: binding,
    ...over,
  });

  function validReceipt(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      schemaVersion: 1,
      runtimeId: "rt_abcd1234efgh5678",
      version: "1.4.230",
      serverPid: 4242,
      serverStartTicks: "99887766",
      nodeBinary: path.join(root, "runtimes", "node-24.21.0", "bin", "node"),
      serverEntry: path.join(root, "releases", "1.4.230", "orcad-server.js"),
      userData: path.join(root, "runtime", "user-data"),
      boundEndpoint: "ws://127.0.0.1:6769",
      advertisedEndpoint: "wss://orca.mso.example.com",
      readyAt: "2026-10-19T10:00:00.000Z",
      ...over,
    };
  }

  function snapshot(over: Partial<OrcaProcessSnapshot> = {}): OrcaProcessSnapshot {
    const nodeBinary = path.join(root, "runtimes", "node-24.21.0", "bin", "node");
    return {
      pid: 4242,
      startTicks: "99887766",
      uid: typeof process.getuid === "function" ? process.getuid() : 1000,
      exe: nodeBinary,
      argv: [nodeBinary, path.join(root, "releases", "1.4.230", "orcad-server.js"), "--json"],
      ...over,
    };
  }

  const writeStatus = (content: unknown) => writeFile(path.join(root, "private-status.json"), JSON.stringify(content), { mode: 0o600 });
  const writeReceipt = (content: unknown) => writeFile(path.join(root, "runtime-identity.json"), JSON.stringify(content), { mode: 0o600 });

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "mso-orca-readiness-"));
    await chmod(root, 0o700);
    // The canonical identity proof resolves these receipt paths, so they must exist.
    await mkdir(path.join(root, "runtimes", "node-24.21.0", "bin"), { recursive: true });
    await writeFile(path.join(root, "runtimes", "node-24.21.0", "bin", "node"), "", { mode: 0o755 });
    await mkdir(path.join(root, "releases", "1.4.230"), { recursive: true });
    await writeFile(path.join(root, "releases", "1.4.230", "orcad-server.js"), "", { mode: 0o600 });
    await mkdir(path.join(root, "runtime", "user-data"), { recursive: true });
    process.env.ORCA_HOME = root;
    snapshots.clear();
    snapshots.set(4242, snapshot());
  });

  afterAll(async () => {
    delete process.env.ORCA_HOME;
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("returns available only with a valid status, valid receipt, and matching owned process", async () => {
    await writeStatus(statusPayload());
    await writeReceipt(validReceipt());
    const res = await getOrcaReadiness(deps());
    expect(res.available).toBe(true);
    if (res.available) {
      expect(res.webClientUrl).toBe(buildOrcaWebClientUrl(ORIGIN, pairingUrl()));
      expect(res.startTicks).toBe("99887766");
    }
  });

  it("rejects a release entry that symlinks to a foreign script", async () => {
    const entry = path.join(root, "releases", "1.4.230", "orcad-server.js");
    const foreign = path.join(root, "foreign.js");
    await writeFile(foreign, "", { mode: 0o600 });
    await rm(entry);
    await symlink(foreign, entry);
    await writeStatus(statusPayload());
    await writeReceipt(validReceipt());
    expect(await getOrcaReadiness(deps())).toMatchObject({
      available: false,
      reason: "process_identity_mismatch",
    });
  });

  it("denies when the owned process does not own the exact LISTEN socket", async () => {
    await writeStatus(statusPayload());
    await writeReceipt(validReceipt());
    const res = await getOrcaReadiness(deps({
      readBinding: async () => ({ ok: false, reason: "listener_not_owned_by_process" }),
    }));
    expect(res).toMatchObject({ available: false, reason: "listener_not_owned_by_process" });
  });

  it("fails with a clear reason when ORCA_HOME is invalid (no silent fallback)", async () => {
    process.env.ORCA_HOME = "relative/orca";
    await expect(getOrcaReadiness(deps())).resolves.toMatchObject({ available: false, reason: "managed_root_invalid" });
    process.env.ORCA_HOME = root;
  });

  it("denies a missing or insecure status file", async () => {
    expect(await getOrcaReadiness(deps())).toMatchObject({ available: false, reason: "status_file_missing" });
    await writeStatus({});
    await chmod(path.join(root, "private-status.json"), 0o644);
    expect(await getOrcaReadiness(deps())).toMatchObject({ available: false, reason: "status_file_insecure" });
  });

  it("requires a mandatory secure runtime-identity.json (never optional)", async () => {
    await writeStatus(statusPayload());
    expect(await getOrcaReadiness(deps())).toMatchObject({ available: false, reason: "runtime_identity_missing" });
    await writeReceipt(validReceipt());
    await chmod(path.join(root, "runtime-identity.json"), 0o644);
    expect(await getOrcaReadiness(deps())).toMatchObject({ available: false, reason: "runtime_identity_insecure" });
  });

  it("rejects a receipt that does not match the status or the managed root", async () => {
    await writeStatus(statusPayload());
    await writeReceipt(validReceipt({ runtimeId: "rt_other" }));
    expect(await getOrcaReadiness(deps())).toMatchObject({ available: false, reason: "runtime_identity_mismatch" });
    await writeReceipt(validReceipt({ serverEntry: "/tmp/orcad-server.js" }));
    expect(await getOrcaReadiness(deps())).toMatchObject({ available: false, reason: "runtime_identity_mismatch" });
    await writeReceipt(validReceipt({ advertisedEndpoint: "wss://evil.example.com" }));
    expect(await getOrcaReadiness(deps())).toMatchObject({ available: false, reason: "runtime_identity_mismatch" });
  });

  it("denies when the process identity cannot be read, or is reused/foreign/mismatched", async () => {
    await writeStatus(statusPayload());
    await writeReceipt(validReceipt());
    snapshots.clear();
    expect(await getOrcaReadiness(deps())).toMatchObject({ available: false, reason: "process_identity_unavailable" });
    snapshots.set(4242, snapshot({ startTicks: "1" }));
    expect(await getOrcaReadiness(deps())).toMatchObject({ available: false, reason: "process_identity_mismatch" });
    snapshots.set(4242, snapshot({ exe: "/usr/bin/node" }));
    expect(await getOrcaReadiness(deps())).toMatchObject({ available: false, reason: "process_identity_mismatch" });
  });

  it("binds receipt.serverPid to status.health.pid", async () => {
    await writeStatus(statusPayload());
    await writeReceipt(validReceipt({ serverPid: 5555 }));
    snapshots.set(5555, snapshot({ pid: 5555 }));
    expect(await getOrcaReadiness(deps())).toMatchObject({ available: false, reason: "runtime_identity_mismatch" });
  });

  it("fails closed on a symlinked status file", async () => {
    const target = path.join(root, "real-status.json");
    await writeFile(target, JSON.stringify(statusPayload()), { mode: 0o600 });
    await symlink(target, path.join(root, "private-status.json"));
    expect(await getOrcaReadiness(deps())).toMatchObject({ available: false, reason: "status_file_insecure" });
  });

  it("ignores the test runner's own PID as an Orca identity", async () => {
    const runnerPayload = statusPayload();
    runnerPayload.health.pid = process.pid;
    await writeStatus(runnerPayload);
    const receipt = validReceipt({ serverPid: process.pid });
    await writeReceipt(receipt);
    const runnerReader: OrcaProcessReader = async () => ({
      pid: process.pid,
      startTicks: "99887766",
      uid: typeof process.getuid === "function" ? process.getuid() : 1000,
      exe: process.execPath,
      argv: [process.execPath, receipt.serverEntry as string, "--json"],
    });
    expect(await getOrcaReadiness(deps({ readProcess: runnerReader }))).toMatchObject({ available: false, reason: "process_identity_mismatch" });
  });
});
