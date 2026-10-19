import { describe, expect, it, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const testDir = await mkdtemp(path.join(os.tmpdir(), "mso-orca-test-"));
process.env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE = "{id}.mso.example.com";
process.env.OS_DEVICE_STORE = path.join(testDir, "devices.json");
process.env.OS_SESSION_SECRET = "s".repeat(32);

const { contentSecurityPolicy } = await import("./proxy-csp");
const { isServiceWorkerRequest } = await import("./proxy-headers");
const { socketPolicy } = await import("./socket-policy");
const { createManagedAppCookie } = await import("./session");
const devices = await import("@/lib/auth/device-store");

describe("Orca CSP containment and capabilities", () => {
  const PREFIX_URL = "https://orca.mso.example.com/";
  const COCKPIT = "https://mso.example.com";

  it("adds worker-src app root and wasm-unsafe-eval for Orca only", () => {
    const csp = contentSecurityPolicy(PREFIX_URL, undefined, {
      cockpitOrigin: COCKPIT,
      appId: "orca",
    });

    // Orca must allow its app root for dedicated/shared workers, plus blob:
    expect(csp).toContain(`worker-src ${PREFIX_URL} blob:`);
    // Orca must allow wasm-unsafe-eval in script-src
    expect(csp).toContain(`script-src ${PREFIX_URL} 'unsafe-inline' blob: 'wasm-unsafe-eval'`);
    // Orca must NEVER allow unsafe-eval
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("preserves strict blob-only worker-src and no wasm for non-Orca apps", () => {
    const hermesCsp = contentSecurityPolicy("https://hermes.mso.example.com/", undefined, {
      cockpitOrigin: COCKPIT,
      appId: "hermes",
    });
    expect(hermesCsp).toContain("worker-src blob:");
    expect(hermesCsp).not.toContain("https://hermes.mso.example.com/ blob:");
    expect(hermesCsp).not.toContain("wasm-unsafe-eval");
    expect(hermesCsp).not.toContain("unsafe-eval");

    const defaultCsp = contentSecurityPolicy(PREFIX_URL, undefined, {
      cockpitOrigin: COCKPIT,
    });
    expect(defaultCsp).toContain("worker-src blob:");
    expect(defaultCsp).not.toContain("wasm-unsafe-eval");
  });

  it("refuses upstream attempts to widen Orca script-src with unsafe-eval", () => {
    const upstreamWithEval = "default-src 'self'; script-src 'self' 'unsafe-eval' https://evil.example";
    const csp = contentSecurityPolicy(PREFIX_URL, upstreamWithEval, {
      cockpitOrigin: COCKPIT,
      appId: "orca",
    });
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("https://evil.example");
  });
});

describe("Service Worker fetch rejection", () => {
  it("rejects Sec-Fetch-Dest serviceworker regardless of requested path or extension", () => {
    expect(isServiceWorkerRequest(["assets", "foo.js"], "serviceworker")).toBe(true);
    expect(isServiceWorkerRequest(["assets", "bundle.min.js"], "ServiceWorker")).toBe(true);
    expect(isServiceWorkerRequest(["main.wasm"], "serviceworker")).toBe(true);
  });

  it("retains conventional filename defense even without Sec-Fetch-Dest", () => {
    expect(isServiceWorkerRequest(["sw.js"], null)).toBe(true);
    expect(isServiceWorkerRequest(["service-worker.js"], undefined)).toBe(true);
    expect(isServiceWorkerRequest(["serviceworker.js"], "")).toBe(true);
  });

  it("permits regular dedicated and shared worker requests for Orca", () => {
    expect(isServiceWorkerRequest(["assets", "editor.worker.js"], "worker")).toBe(false);
    expect(isServiceWorkerRequest(["shared.js"], "sharedworker")).toBe(false);
    expect(isServiceWorkerRequest(["assets", "normal.js"], "script")).toBe(false);
  });
});

describe("Orca WebSocket upgrade Origin validation", () => {
  afterAll(async () => {
    delete process.env.OS_DEVICE_STORE;
    delete process.env.OS_SESSION_SECRET;
    delete process.env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE;
    await rm(testDir, { recursive: true, force: true });
  });

  it("permits Orca WS upgrade only with exact same-origin HTTPS Origin", async () => {
    const ownerId = "o".repeat(32);
    await devices.approveDevice(ownerId, "owner", "owner");

    const id = "d".repeat(32);
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

    // Valid same-origin request
    const valid = new NextRequest("https://orca.mso.example.com/socket?orca-client=web", {
      headers: {
        host: "orca.mso.example.com",
        origin: "https://orca.mso.example.com",
        upgrade: "websocket",
        connection: "Upgrade",
        cookie: `__Host-mso-managed-app=${cookie}`,
        authorization: "bearer-token-should-be-stripped",
      },
    });

    const decision = await socketPolicy(valid);
    expect(decision).not.toBeNull();
    expect(decision?.identity).toBe(id);
    expect(decision?.target).toContain("orca-client=web");
    expect(decision?.headers.cookie).toBeUndefined();
    expect(decision?.headers.authorization).toBeUndefined();

    // Absent Origin -> denied
    const missingOrigin = new NextRequest("https://orca.mso.example.com/socket?orca-client=web", {
      headers: {
        host: "orca.mso.example.com",
        upgrade: "websocket",
        connection: "Upgrade",
        cookie: `__Host-mso-managed-app=${cookie}`,
      },
    });
    expect(await socketPolicy(missingOrigin)).toBeNull();

    // Sibling Origin -> denied
    const siblingOrigin = new NextRequest("https://orca.mso.example.com/socket?orca-client=web", {
      headers: {
        host: "orca.mso.example.com",
        origin: "https://hermes.mso.example.com",
        upgrade: "websocket",
        connection: "Upgrade",
        cookie: `__Host-mso-managed-app=${cookie}`,
      },
    });
    expect(await socketPolicy(siblingOrigin)).toBeNull();

    // Wrong scheme (wss://) -> denied
    const wrongScheme = new NextRequest("https://orca.mso.example.com/socket?orca-client=web", {
      headers: {
        host: "orca.mso.example.com",
        origin: "wss://orca.mso.example.com",
        upgrade: "websocket",
        connection: "Upgrade",
        cookie: `__Host-mso-managed-app=${cookie}`,
      },
    });
    expect(await socketPolicy(wrongScheme)).toBeNull();

    // Viewer role -> denied
    await devices.setDeviceRole(id, "viewer");
    expect(await socketPolicy(valid)).toBeNull();

    // Revoked / invalidated session -> denied even with valid-looking cookie
    await devices.setDeviceRole(id, "operator");
    await devices.invalidateDeviceSessions(id);
    expect(await socketPolicy(valid)).toBeNull();

    // Generic non-Orca clients (e.g. hermes) do NOT require Origin header
    const freshId = "e".repeat(32);
    await devices.approveDevice(freshId, "operator", "operator");
    const freshPolicy = await devices.currentSessionPolicy("host");
    const now = Date.now();
    const freshHermesCookie = createManagedAppCookie("hermes", {
      device_id: freshId,
      issued_at: now,
      expires_at: now + 60_000,
      cookie_scope: freshPolicy.scope,
      cookie_epoch: freshPolicy.epoch,
    }, process.env.OS_SESSION_SECRET!);
    const freshHermesNoOrigin = new NextRequest("https://hermes.mso.example.com/socket", {
      headers: {
        host: "hermes.mso.example.com",
        upgrade: "websocket",
        connection: "Upgrade",
        cookie: `__Host-mso-managed-app=${freshHermesCookie}`,
      },
    });
    const hermesDecision = await socketPolicy(freshHermesNoOrigin);
    expect(hermesDecision).not.toBeNull();
    expect(hermesDecision?.identity).toBe(freshId);
  });
});

describe("Bootstrap pairing fragment preservation", () => {
  it("preserves an existing pairing fragment while removing app_ticket without leaking secrets", () => {
    // Simulate what the bootstrap client script does on the iframe URL
    const originalHash = "#pairing=enc_v1_pairing_secret_key&app_ticket=temp_ticket_xyz";
    const p = new URLSearchParams(originalHash.slice(1));
    const ticket = p.get("app_ticket");
    expect(ticket).toBe("temp_ticket_xyz");

    p.delete("app_ticket");
    const remainingHash = p.toString() ? "#" + p.toString() : "";
    expect(remainingHash).toBe("#pairing=enc_v1_pairing_secret_key");
    expect(remainingHash).not.toContain("app_ticket");
    // Ensure pairing token stays in fragment and never converted to query param
    expect(remainingHash.startsWith("#pairing=")).toBe(true);
  });
});
