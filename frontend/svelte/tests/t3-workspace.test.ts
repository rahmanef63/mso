import assert from "node:assert/strict";
import { test } from "node:test";
import { APP_SLUGS, visibleDockApps } from "../src/lib/shell/shell-registry.ts";
import type { ManagedAppItem } from "../src/lib/managed-apps/managed-apps-api.ts";
import { managedT3Dashboard, readManagedT3, T3_CONNECT_SANDBOX, T3_CONNECT_URL } from "../src/lib/runtime-apps/t3-workspace.ts";

const cockpit = "https://mso.example.com";
const dashboard = "https://t3.mso.example.com/";
const running: ManagedAppItem = {
  id: "t3", name: "T3 Code", description: "Managed workspace", installed: true,
  installationType: "systemd", state: "running", healthy: true, version: null,
  publicDashboardUrl: dashboard, dashboardAvailable: true, diagnostic: null, supportedActions: [],
};

test("T3 launcher is available only to an Operator or Owner", () => {
  assert.equal(APP_SLUGS.t3, "t3");
  for (const [role, visible] of [["viewer", false], [null, false], ["operator", true], ["owner", true]] as const) {
    assert.equal(visibleDockApps(role).some((app) => app.app === "t3"), visible);
  }
});

test("T3 embeds only the official HTTPS root, without credential or sandbox elevation", () => {
  const url = new URL(T3_CONNECT_URL);
  assert.equal(url.href, "https://app.t3.codes/");
  assert.equal(url.username + url.password + url.search + url.hash, "");
  assert.deepEqual(T3_CONNECT_SANDBOX.split(" ").sort(), ["allow-forms", "allow-same-origin", "allow-scripts"]);
});

test("separate managed dashboard needs a running app and a clean isolated HTTPS URL", () => {
  assert.equal(managedT3Dashboard(running, cockpit), dashboard);
  for (const publicDashboardUrl of [
    "javascript:alert(1)", "http://127.0.0.1:3773/", cockpit,
    "https://user:pass@t3.example.com/", "https://t3.example.com/?token=secret",
    "https://t3.example.com/#token=secret",
  ]) assert.equal(managedT3Dashboard({ ...running, publicDashboardUrl }, cockpit), null);
  for (const overrides of [{ dashboardAvailable: false }, { healthy: false }, { installed: false }, { state: "stopped" as const }, { id: "orca" }]) {
    assert.equal(managedT3Dashboard({ ...running, ...overrides }, cockpit), null);
  }
  assert.equal(managedT3Dashboard(null, cockpit), null);
});

test("dashboard lookup uses only the existing authenticated managed-apps read", async () => {
  const signal = new AbortController().signal;
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "/api/v1/managed-apps");
    assert.equal(init?.method, "GET");
    assert.equal(init?.cache, "no-store");
    return Response.json({ apps: [running] });
  };
  assert.deepEqual(await readManagedT3(signal, fetcher), running);
  assert.equal(await readManagedT3(signal, async () => Response.json({ apps: [] })), null);
  await assert.rejects(readManagedT3(signal, async () => Response.json({}, { status: 403 })), { status: 403 });
});
