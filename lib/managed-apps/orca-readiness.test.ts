import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE = "{id}.mso.example.com";
  process.env.OS_PUBLIC_ORIGIN = "https://mso.example.com";
  process.env.OS_SESSION_SECRET = "s".repeat(32);
});

import { parseOrcaPrivateStatus } from "./orca-readiness";
import { buildOrcaWebClientUrl } from "./orca-pairing";

const ORIGIN = "https://orca.mso.example.com";

function pairingUrl(): string {
  const payload = { v: 2, endpoint: "wss://orca.mso.example.com", deviceToken: "dev_tok_12345", publicKeyB64: "pub_key_12345", scope: "runtime" };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `orca://pair?code=${b64}`;
}

function payload(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    type: "orca_server_ready",
    schemaVersion: 1,
    runtimeId: "rt_abcd1234efgh5678",
    boundEndpoint: "ws://127.0.0.1:6769",
    advertisedEndpoint: "wss://orca.mso.example.com",
    pairing: { available: true, scope: "runtime", url: pairingUrl(), webClientUrl: "https://orca.mso.example.com/?token=leak" },
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

describe("parseOrcaPrivateStatus schema and endpoint invariants", () => {
  it("accepts the exact tagged schema and ignores artifactVersion as an override", async () => {
    const res = await parseOrcaPrivateStatus(JSON.stringify(payload({ artifactVersion: "9.9.9" })), ORIGIN);
    expect(res.available).toBe(true);
    if (res.available) {
      expect(res.runtimeId).toBe("rt_abcd1234efgh5678");
      expect(res.serverPid).toBe(4242);
      expect(res.webClientUrl).toBe(buildOrcaWebClientUrl(ORIGIN, pairingUrl()));
    }
  });

  it("requires the exact readiness tag and health buildVersion (no artifactVersion fallback)", async () => {
    expect(await parseOrcaPrivateStatus(JSON.stringify(payload({ type: "orca_other" })), ORIGIN)).toMatchObject({ available: false, reason: "unexpected_status_type" });
    expect(await parseOrcaPrivateStatus(JSON.stringify(payload({ schemaVersion: 2 })), ORIGIN)).toMatchObject({ available: false, reason: "unsupported_status_schema" });
    const forged = payload({ artifactVersion: "1.4.230" });
    forged.health.buildVersion = "1.4.229";
    expect(await parseOrcaPrivateStatus(JSON.stringify(forged), ORIGIN)).toMatchObject({ available: false, reason: "incompatible_version" });
  });

  it("requires the pinned Node version and ABI", async () => {
    const badNode = payload();
    badNode.health.nodeVersion = "26.7.0";
    expect(await parseOrcaPrivateStatus(JSON.stringify(badNode), ORIGIN)).toMatchObject({ available: false, reason: "incompatible_node_version" });
    const badAbi = payload();
    badAbi.health.nodeAbi = "115";
    expect(await parseOrcaPrivateStatus(JSON.stringify(badAbi), ORIGIN)).toMatchObject({ available: false, reason: "incompatible_node_abi" });
  });

  it("requires a ws loopback bound endpoint with no credentials, path, query, or hash", async () => {
    expect(await parseOrcaPrivateStatus(JSON.stringify(payload()), ORIGIN)).toMatchObject({ available: true });
    for (const boundEndpoint of ["http://127.0.0.1:6769", "ws://127.0.0.1:6769/foo", "ws://u:p@127.0.0.1:6769", "ws://127.0.0.1:6769?x=1", "ws://127.0.0.1:6769#f"]) {
      expect(await parseOrcaPrivateStatus(JSON.stringify(payload({ boundEndpoint })), ORIGIN)).toMatchObject({ available: false, reason: "malformed_bound_endpoint" });
    }
    expect(await parseOrcaPrivateStatus(JSON.stringify(payload({ boundEndpoint: "ws://0.0.0.0:6769" })), ORIGIN)).toMatchObject({ available: false, reason: "non_loopback_bound_endpoint" });
    expect(await parseOrcaPrivateStatus(JSON.stringify(payload({ boundEndpoint: "ws://127.0.0.1:6768" })), ORIGIN)).toMatchObject({ available: false, reason: "unexpected_bound_port" });
  });

  it("requires an exact wss advertised endpoint on the configured origin", async () => {
    const cases: Array<[string, string]> = [
      ["ws://orca.mso.example.com", "advertised_origin_mismatch"],
      ["https://orca.mso.example.com", "advertised_origin_mismatch"],
      ["wss://evil.example.com", "advertised_origin_mismatch"],
      ["wss://orca.mso.example.com/socket", "advertised_origin_mismatch"],
      ["wss://orca.mso.example.com?x=1", "advertised_origin_mismatch"],
      ["wss://user@orca.mso.example.com", "advertised_origin_mismatch"],
      ["not a url", "malformed_advertised_endpoint"],
    ];
    for (const [advertisedEndpoint, reason] of cases) {
      expect(await parseOrcaPrivateStatus(JSON.stringify(payload({ advertisedEndpoint })), ORIGIN)).toMatchObject({ available: false, reason });
    }
  });

  it("requires live terminal daemon and explicit runtime pairing scope", async () => {
    const degraded = payload();
    degraded.health.terminalDaemon.state = "degraded";
    expect(await parseOrcaPrivateStatus(JSON.stringify(degraded), ORIGIN)).toMatchObject({ available: false, reason: "terminal_daemon_unhealthy" });
    expect(await parseOrcaPrivateStatus(JSON.stringify(payload({ pairing: { available: false, scope: "runtime", url: pairingUrl() } })), ORIGIN)).toMatchObject({ available: false, reason: "pairing_unavailable" });
    expect(await parseOrcaPrivateStatus(JSON.stringify(payload({ pairing: { available: true, url: pairingUrl() } })), ORIGIN)).toMatchObject({ available: false, reason: "pairing_unavailable" });
    expect(await parseOrcaPrivateStatus(JSON.stringify(payload({ pairing: { available: true, scope: "mobile", url: pairingUrl() } })), ORIGIN)).toMatchObject({ available: false, reason: "pairing_unavailable" });
  });

  it("never trusts an upstream webClientUrl and never exposes a query secret", async () => {
    const res = await parseOrcaPrivateStatus(JSON.stringify(payload()), ORIGIN);
    expect(res.available).toBe(true);
    if (res.available) {
      const parsed = new URL(res.webClientUrl);
      expect(parsed.pathname).toBe("/web-index.html");
      expect(parsed.search).toBe("");
      expect(res.webClientUrl).not.toContain("token=leak");
    }
  });
});
