import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const auth = vi.hoisted(() => ({ context: null as null | { session: Record<string, unknown>; role: string } }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: async () => auth.context }));
vi.mock("@/lib/demo", () => ({ IS_DEMO: false }));

const orca = vi.hoisted(() => ({
  mode: "fake" as "fake" | "real",
  fake: { available: true, pairingUrl: "orca://pair?code=abc", webClientUrl: "https://orca.mso.example.com/web-index.html#pairing=abc", runtimeId: "rt_1", serverPid: 4242, boundEndpoint: "ws://127.0.0.1:6769", advertisedEndpoint: "wss://orca.mso.example.com" },
}));
type OrcaReadinessModule = typeof import("@/lib/managed-apps/orca-readiness");

vi.mock("@/lib/managed-apps/orca-readiness", async (importOriginal) => {
  const actual = (await importOriginal()) as OrcaReadinessModule;
  return {
    ...actual,
    getOrcaReadiness: async (deps?: Parameters<typeof actual.getOrcaReadiness>[0]) =>
      orca.mode === "real" ? actual.getOrcaReadiness(deps) : orca.fake,
  };
});

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE = "{id}.mso.example.com";
  process.env.OS_PUBLIC_ORIGIN = "https://mso.example.com";
  process.env.OS_SESSION_SECRET = "s".repeat(32);
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const { GET } = await import("./route");
const { buildOrcaWebClientUrl } = await import("@/lib/managed-apps/orca-pairing");

const ORIGIN = "https://orca.mso.example.com";
function validPairingUrl(): string {
  const payload = { v: 2, endpoint: ORIGIN.replace(/^https:/, "wss:"), deviceToken: "dev_tok_12345", publicKeyB64: "pub_key_12345", scope: "runtime" };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `orca://pair?code=${b64}`;
}

const ctx = (id = "orca") => ({ params: Promise.resolve({ id }) });
const get = (id = "orca") => GET(new Request("https://mso.example.com/api/v1/managed-apps/x/session"), ctx(id));

function session(role: string) {
  auth.context = { session: { device_id: "d1", expires_at: Date.now() + 3_600_000 }, role };
}

beforeEach(() => {
  auth.context = null;
  orca.mode = "fake";
  const pairingUrl = validPairingUrl();
  orca.fake = { available: true, pairingUrl, webClientUrl: buildOrcaWebClientUrl(ORIGIN, pairingUrl), runtimeId: "rt_1", serverPid: 4242, boundEndpoint: "ws://127.0.0.1:6769", advertisedEndpoint: "wss://orca.mso.example.com" };
});

describe("managed-app session route authorization", () => {
  it("denies unauthenticated and Viewer sessions without leaking anything", async () => {
    const unauth = await get();
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("cache-control")).toContain("no-store");
    expect(await unauth.text()).not.toContain("pairing");

    session("viewer");
    const viewer = await get();
    expect(viewer.status).toBe(401);
    expect(viewer.headers.get("cache-control")).toContain("no-store");
  });

  it("denies any app when no split origin is configured", async () => {
    session("operator");
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", "");
    const fresh = await import("./route");
    const res = await fresh.GET(new Request("https://mso.example.com/x"), ctx("orca"));
    expect(res.status).toBe(404);
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns 503 with no-store and no pairing or ticket when readiness is unavailable", async () => {
    session("operator");
    orca.fake = { available: false, reason: "runtime_identity_missing" } as never;
    const res = await get();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.text();
    expect(body).toContain("runtime_identity_missing");
    expect(body).not.toContain("pairing");
    expect(body).not.toContain("ticket");
    expect(body).not.toContain("orca://");
  });

  it("enforces a real missing identity through the route (not a mocked success)", async () => {
    session("operator");
    orca.mode = "real";
    const root = await mkdtemp(path.join(os.tmpdir(), "mso-orca-session-"));
    try {
      process.env.ORCA_HOME = root;
      const status = {
        type: "orca_server_ready",
        schemaVersion: 1,
        runtimeId: "rt_1",
        boundEndpoint: "ws://127.0.0.1:6769",
        advertisedEndpoint: "wss://orca.mso.example.com",
        pairing: { available: true, scope: "runtime", url: validPairingUrl() },
        health: { buildVersion: "1.4.230", nodeVersion: "24.21.0", nodeAbi: "137", pid: 4242, terminalDaemon: { state: "live", ownsFreshSessions: true, selfTest: { ok: true } } },
      };
      await writeFile(path.join(root, "private-status.json"), JSON.stringify(status), { mode: 0o600 });
      const res = await get();
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ reason: "runtime_identity_missing" });
    } finally {
      delete process.env.ORCA_HOME;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns 200 no-store with only intended fields for an authorized Orca session", async () => {
    session("operator");
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["origin", "pairingUrl", "runtimeId", "ticket", "webClientUrl"]);
    expect(body.origin).toBe("https://orca.mso.example.com");
    expect(body.webClientUrl).toBe(buildOrcaWebClientUrl(ORIGIN, orca.fake.pairingUrl));
    expect(typeof body.ticket).toBe("string");
  });

  it("still serves a non-Orca app with origin and ticket only", async () => {
    session("operator");
    const res = await get("hermes");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["origin", "ticket"]);
    expect(body.origin).toBe("https://hermes.mso.example.com");
  });
});

afterAll(() => {
  delete process.env.ORCA_HOME;
});
