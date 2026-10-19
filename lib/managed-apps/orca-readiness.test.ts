import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE = "{id}.mso.example.com";
  process.env.OS_PUBLIC_ORIGIN = "https://mso.example.com";
  process.env.OS_SESSION_SECRET = "s".repeat(32);
});

import { parseOrcaPrivateStatus, getOrcaReadiness } from "./orca-readiness";

const ORIGIN = "https://orca.mso.example.com";
const WSS_ENDPOINT = "wss://orca.mso.example.com/socket?orca-client=web";

function validPairingUrl(): string {
  const payload = {
    v: 2,
    endpoint: WSS_ENDPOINT,
    deviceToken: "dev_tok_12345",
    publicKeyB64: "pub_key_12345",
    scope: "runtime",
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `orca://pair?code=${b64}`;
}

function validPayload(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    artifactVersion: "1.4.230",
    boundEndpoint: "http://127.0.0.1:6769",
    advertisedEndpoint: "wss://orca.mso.example.com",
    runtimeId: "rt_abcd1234efgh5678",
    health: {
      pid: process.pid,
      terminalDaemon: {
        state: "live",
        ownsFreshSessions: true,
        selfTest: { ok: true, coverage: "pty-spawn" },
      },
    },
    pairing: {
      available: true,
      scope: "runtime",
      url: validPairingUrl(),
      webClientUrl: "https://orca.mso.example.com/#pairing=code",
    },
    ...overrides,
  };
}

describe("Orca private readiness parsing and invariants", () => {
  it("accepts valid status payload conforming to Orca 1.4.230 contracts", async () => {
    const raw = JSON.stringify(validPayload());
    const res = await parseOrcaPrivateStatus(raw, ORIGIN);
    expect(res.available).toBe(true);
    if (res.available) {
      expect(res.runtimeId).toBe("rt_abcd1234efgh5678");
      expect(res.pairingUrl).toContain("orca://pair");
      expect(res.webClientUrl).toBe("https://orca.mso.example.com/#pairing=code");
    }
  });

  it("rejects mismatched artifact versions", async () => {
    const raw = JSON.stringify(validPayload({ artifactVersion: "1.4.229" }));
    const res = await parseOrcaPrivateStatus(raw, ORIGIN);
    expect(res.available).toBe(false);
    if (!res.available) expect(res.reason).toBe("incompatible_version");
  });

  it("rejects non-6769 or non-loopback bound endpoints", async () => {
    const wrongPort = JSON.stringify(validPayload({ boundEndpoint: "http://127.0.0.1:6768" }));
    const res1 = await parseOrcaPrivateStatus(wrongPort, ORIGIN);
    expect(res1.available).toBe(false);
    if (!res1.available) expect(res1.reason).toBe("unexpected_bound_port");

    const nonLoopback = JSON.stringify(validPayload({ boundEndpoint: "http://0.0.0.0:6769" }));
    const res2 = await parseOrcaPrivateStatus(nonLoopback, ORIGIN);
    expect(res2.available).toBe(false);
    if (!res2.available) expect(res2.reason).toBe("non_loopback_bound_endpoint");
  });

  it("rejects dead process PID", async () => {
    const deadPid = JSON.stringify(validPayload({ health: { ...validPayload().health, pid: 99999999 } }));
    const res = await parseOrcaPrivateStatus(deadPid, ORIGIN);
    expect(res.available).toBe(false);
    if (!res.available) expect(res.reason).toBe("process_dead");
  });

  it("rejects degraded terminal daemon or failed self-test", async () => {
    const degraded = JSON.stringify(
      validPayload({
        health: {
          pid: process.pid,
          terminalDaemon: { state: "degraded", ownsFreshSessions: true, selfTest: { ok: true } },
        },
      }),
    );
    const res = await parseOrcaPrivateStatus(degraded, ORIGIN);
    expect(res.available).toBe(false);
    if (!res.available) expect(res.reason).toBe("terminal_daemon_unhealthy");
  });
});

describe("getOrcaReadiness filesystem security gates", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "mso-orca-readiness-"));
    process.env.ORCA_HOME = tmpRoot;
    await chmod(tmpRoot, 0o700);
  });

  afterAll(async () => {
    delete process.env.ORCA_HOME;
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  });

  it("reads status file with 0600 permissions in 0700 managed directory", async () => {
    const statusFile = path.join(tmpRoot, "private-status.json");
    await writeFile(statusFile, JSON.stringify(validPayload()), { mode: 0o600 });

    const res = await getOrcaReadiness();
    expect(res.available).toBe(true);
  });

  it("fails closed on symlinked status file", async () => {
    const targetFile = path.join(tmpRoot, "real-status.json");
    await writeFile(targetFile, JSON.stringify(validPayload()), { mode: 0o600 });
    const symlinkFile = path.join(tmpRoot, "private-status.json");
    await symlink(targetFile, symlinkFile);

    const res = await getOrcaReadiness();
    expect(res.available).toBe(false);
    if (!res.available) expect(res.reason).toBe("status_file_insecure_or_missing");
  });

  it("fails closed if status file exceeds 64KB size cap", async () => {
    const statusFile = path.join(tmpRoot, "private-status.json");
    await writeFile(statusFile, "x".repeat(70000), { mode: 0o600 });

    const res = await getOrcaReadiness();
    expect(res.available).toBe(false);
    if (!res.available) expect(res.reason).toBe("status_file_insecure_or_missing");
  });

  it("validates runtime-identity.json receipt when present", async () => {
    const statusFile = path.join(tmpRoot, "private-status.json");
    await writeFile(statusFile, JSON.stringify(validPayload()), { mode: 0o600 });

    const idFile = path.join(tmpRoot, "runtime-identity.json");
    await writeFile(
      idFile,
      JSON.stringify({
        schemaVersion: 1,
        runtimeId: "rt_abcd1234efgh5678",
        version: "1.4.230",
        serverPid: process.pid,
      }),
      { mode: 0o600 },
    );

    const res = await getOrcaReadiness();
    expect(res.available).toBe(true);
  });

  it("fails closed when runtime-identity.json mismatches private status", async () => {
    const statusFile = path.join(tmpRoot, "private-status.json");
    await writeFile(statusFile, JSON.stringify(validPayload()), { mode: 0o600 });

    const idFile = path.join(tmpRoot, "runtime-identity.json");
    await writeFile(
      idFile,
      JSON.stringify({
        schemaVersion: 1,
        runtimeId: "rt_different_mismatch",
        version: "1.4.230",
        serverPid: process.pid,
      }),
      { mode: 0o600 },
    );

    const res = await getOrcaReadiness();
    expect(res.available).toBe(false);
    if (!res.available) expect(res.reason).toBe("runtime_identity_mismatch");
  });
});
