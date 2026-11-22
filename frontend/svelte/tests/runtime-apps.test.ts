import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  readCamoufoxSession,
  readCamoufoxStatus,
  readDesktopContainers,
  readN8nApp,
  resolveDesktopScreenshotUrl,
  runDesktopLifecycle,
  safeViewerHref,
  sanitizeLogLines,
  setCamoufoxPower,
  type DesktopContainerItem,
  type ManagedAppItem,
} from "../src/lib/runtime-apps/runtime-apps-api.ts";

const signal = new AbortController().signal;
const bridge = { surface: "rust-host" as const, apiBaseOrigin: "http://127.0.0.1:4173" };
const jsonOf = (body: unknown, status = 200): typeof fetch => async () => Response.json(body, { status });

const sampleContainer: DesktopContainerItem = {
  id: "a1b2c3d4e5f6",
  name: "grokbot-desktop-alpha",
  state: "running",
  status: "Up 12 minutes",
  labels: { user: "rahman", bot: "alpha" },
  created: "2026-11-22 08:00:00 +0000 UTC",
  ports: "127.0.0.1:5901->5901/tcp",
};

const sampleN8n: ManagedAppItem = {
  id: "n8n", name: "n8n", description: "Workflow automation engine", installed: true,
  installationType: "docker", state: "running", healthy: true, version: "1.82.0",
  dashboardAvailable: true, publicDashboardUrl: "https://n8n.example.com",
  supportedActions: ["start", "stop", "restart"], diagnostic: null, domainDiagnostic: null,
};

test("readCamoufoxStatus parses backend and optional status fields and rejects malformed data", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "/api/v1/camoufox/service");
    assert.equal(init?.method, "GET");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.credentials, "same-origin");
    return Response.json({
      running: true, enabled: false, installed: true, viewerReady: true,
      activeState: "active", unit: "camoufox-vnc.service", detail: "running",
    });
  };
  const status = await readCamoufoxStatus(signal, fetcher);
  assert.deepEqual(status, {
    running: true, enabled: false, installed: true, viewerReady: true,
    activeState: "active", unit: "camoufox-vnc.service", detail: "running",
  });
  for (const bad of [null, [], {}, { running: "yes" }, { running: true, enabled: 1 }]) {
    await assert.rejects(readCamoufoxStatus(signal, jsonOf(bad)), /Camoufox status response is invalid/);
  }
});

test("setCamoufoxPower posts start and stop actions via shell bridge", async () => {
  for (const action of ["start", "stop"] as const) {
    const fetcher: typeof fetch = async (input, init) => {
      assert.equal(input, "http://127.0.0.1:4173/api/v1/camoufox/service");
      assert.equal(init?.method, "POST");
      assert.equal(init?.credentials, "include");
      assert.equal(init?.body, JSON.stringify({ action }));
      return Response.json({ running: action === "start", enabled: false, installed: true });
    };
    const result = await setCamoufoxPower(action, signal, fetcher, bridge);
    assert.equal(result.running, action === "start");
  }
});

test("readCamoufoxSession strips raw password and viewerTicket from returned UI object", async () => {
  const secretPass = "super-secret-vnc-password-123";
  const secretTicket = "signed-ticket-token-xyz";
  const withPass = await readCamoufoxSession(signal, jsonOf({
    password: secretPass, viewerTicket: secretTicket,
    viewerOrigin: "https://vnc.example.com", viewerPathPrefix: "/_mso-camoufox",
  }));
  assert.deepEqual(withPass, {
    hasPassword: true, viewerOrigin: "https://vnc.example.com", viewerPathPrefix: "/_mso-camoufox",
  });
  assert.equal("password" in withPass, false);
  assert.equal("viewerTicket" in withPass, false);
  const serialized = JSON.stringify(withPass);
  assert.equal(serialized.includes(secretPass), false);
  assert.equal(serialized.includes(secretTicket), false);

  const noPass = await readCamoufoxSession(signal, jsonOf({
    password: null, viewerTicket: secretTicket, viewerOrigin: "https://vnc.example.com",
    viewerPathPrefix: "/_mso-camoufox", reason: "no_password_file",
  }));
  assert.equal(noPass.hasPassword, false);
  assert.equal("reason" in noPass, false);
});

test("safeViewerHref validates http(s) origin and path prefix safely", () => {
  assert.equal(safeViewerHref("https://vnc.example.com", "/_mso-camoufox"), "https://vnc.example.com/_mso-camoufox");
  assert.equal(safeViewerHref("http://127.0.0.1:6080", null), "http://127.0.0.1:6080/");
  for (const [origin, prefix] of [
    ["javascript:alert(1)", "/vnc"],
    ["data:text/html,hi", null],
    ["https://user:pass@vnc.example.com", "/vnc"],
    ["https://vnc.example.com", "//evil.example.com"],
    ["https://vnc.example.com", "https://evil.example.com"],
  ] as const) {
    assert.equal(safeViewerHref(origin, prefix), null);
  }
});

test("readDesktopContainers and runDesktopLifecycle validate real DTOs and sanitize logs", async () => {
  const list = await readDesktopContainers(signal, jsonOf({ containers: [sampleContainer] }));
  assert.deepEqual(list, { containers: [sampleContainer] });
  for (const bad of [null, {}, { containers: [null] }, { containers: [{ ...sampleContainer, id: " " }] }]) {
    await assert.rejects(readDesktopContainers(signal, jsonOf(bad)), /desktop containers response is invalid/);
  }

  const logFetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "/api/v1/desktop/lifecycle");
    assert.equal(init?.method, "POST");
    assert.equal(init?.body, JSON.stringify({ container: "grokbot-desktop-alpha", action: "logs", lines: 50 }));
    return Response.json({
      action: "logs", container: "grokbot-desktop-alpha", state: sampleContainer,
      logs: ["\u001b[32mready\u001b[0m", "line\u0007two"],
    });
  };
  const logRes = await runDesktopLifecycle("grokbot-desktop-alpha", "logs", signal, logFetcher, undefined, 50);
  assert.equal(logRes.action, "logs");
  assert.equal(sanitizeLogLines(logRes.logs ?? []), "ready\nlinetwo");

  const stopRes = await runDesktopLifecycle("grokbot-desktop-alpha", "stop", signal, jsonOf({
    action: "stop", container: "grokbot-desktop-alpha", state: { ...sampleContainer, state: "exited" },
  }));
  assert.equal(stopRes.state?.state, "exited");
});

test("resolveDesktopScreenshotUrl encodes container and supports bridge and optional screen", () => {
  const webBridge = { surface: "web" as const, apiBaseOrigin: null };
  assert.equal(
    resolveDesktopScreenshotUrl("grokbot desktop/1", webBridge),
    "/api/v1/desktop/screenshot?container=grokbot%20desktop%2F1",
  );
  assert.equal(
    resolveDesktopScreenshotUrl("grokbot-desktop-alpha", bridge, ":99"),
    "http://127.0.0.1:4173/api/v1/desktop/screenshot?container=grokbot-desktop-alpha&screen=%3A99",
  );
  assert.throws(() => resolveDesktopScreenshotUrl("   ", webBridge), ApiError);
});

test("readN8nApp finds n8n entry from managed apps or returns null when absent", async () => {
  const other: ManagedAppItem = { ...sampleN8n, id: "hermes", name: "Hermes" };
  assert.deepEqual(await readN8nApp(signal, jsonOf({ apps: [other, sampleN8n] })), sampleN8n);
  assert.equal(await readN8nApp(signal, jsonOf({ apps: [other] })), null);
});

test("401/403/429/502/503 and HTML fallback fail safely without leaking upstream body", async () => {
  const htmlFetch: typeof fetch = async () => new Response("<html>fallback</html>", {
    status: 200, headers: { "Content-Type": "text/html" },
  });
  const calls = [
    () => readCamoufoxStatus(signal, htmlFetch),
    () => setCamoufoxPower("start", signal, htmlFetch),
    () => readCamoufoxSession(signal, htmlFetch),
    () => readDesktopContainers(signal, htmlFetch),
    () => runDesktopLifecycle("grokbot-desktop-alpha", "restart", signal, htmlFetch),
    () => readN8nApp(signal, htmlFetch),
  ];
  for (const run of calls) {
    await assert.rejects(run, (err: unknown) => err instanceof ApiError && err.status === 502 && /API is unavailable/.test(err.message));
  }

  for (const status of [401, 403, 429, 502, 503]) {
    const errFetch: typeof fetch = async () => Response.json({ error: "secret internal stack trace" }, { status });
    for (const run of [
      () => readCamoufoxStatus(signal, errFetch),
      () => readCamoufoxSession(signal, errFetch),
      () => readDesktopContainers(signal, errFetch),
      () => runDesktopLifecycle("grokbot-desktop-alpha", "start", signal, errFetch),
      () => readN8nApp(signal, errFetch),
    ]) {
      await assert.rejects(
        run,
        (err: unknown) => err instanceof ApiError && err.status === status && !err.message.includes("secret internal stack trace"),
      );
    }
  }
});
