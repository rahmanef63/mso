import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError, createManagedAppsController, createPackagesController, readManagedApps, readPackages,
  safeDashboardUrl, type ManagedAppItem, type ManagedAppsState, type PackagesState, type PackageUpdateSummary,
} from "../src/lib/managed-apps/managed-apps-api.ts";

const sampleApps: ManagedAppItem[] = [
  {
    id: "hermes", name: "Hermes", description: "Hermes Agent runtime and dashboard", installed: true,
    installationType: "systemd", state: "running", healthy: true, version: "1.4.2", dashboardAvailable: true,
    publicDashboardUrl: "https://hermes.example.com", supportedActions: ["start", "stop", "restart", "backup"],
    diagnostic: null, domainDiagnostic: null,
  },
  {
    id: "9router", name: "9Router", description: "9Router AI gateway", installed: false,
    installationType: "not-installed", state: "not-installed", healthy: null, version: null, dashboardAvailable: false,
    publicDashboardUrl: null, supportedActions: [], diagnostic: null,
  },
];
const samplePkgs: PackageUpdateSummary = {
  manager: "apt", available: true, truncated: false, checkedAt: "2026-11-21T19:00:00.000Z", source: "local-cache",
  updates: [
    { name: "openssl", current: "3.0.13-0ubuntu3", candidate: "3.0.13-0ubuntu3.4", architecture: "amd64" },
    { name: "curl", candidate: "8.5.0-2ubuntu10.4" },
  ],
};
const signal = new AbortController().signal;
const jsonOf = (body: unknown): typeof fetch => async () =>
  ({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response);

test("readManagedApps fetches uncached JSON and parses real ManagedAppView DTO", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "/api/v1/managed-apps");
    assert.equal(init?.method, "GET");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store");
    assert.equal((init?.headers as Record<string, string>)?.Accept, "application/json");
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json({ apps: sampleApps });
  };
  assert.deepEqual(await readManagedApps(signal, fetcher), sampleApps);
});

test("readPackages fetches uncached JSON via shell bridge and parses PackageUpdateSummary DTO", async () => {
  const bridge = { surface: "rust-host" as const, apiBaseOrigin: "http://127.0.0.1:4173" };
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "http://127.0.0.1:4173/api/v1/sys/packages");
    assert.equal(init?.method, "GET");
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    return Response.json(samplePkgs);
  };
  assert.deepEqual(await readPackages(signal, fetcher, bridge), samplePkgs);
});

test("safeDashboardUrl accepts only credential-free http/https URLs", () => {
  assert.equal(safeDashboardUrl("https://hermes.example.com"), "https://hermes.example.com/");
  assert.equal(safeDashboardUrl("http://127.0.0.1:9119/ui"), "http://127.0.0.1:9119/ui");
  for (const bad of [null, "", "javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "https://u:p@example.com", "/relative"]) {
    assert.equal(safeDashboardUrl(bad), null);
  }
});

test("malformed managed-apps and package-cache payloads fail closed", async () => {
  const badApps: unknown[] = [
    null, [], {}, { apps: [null] }, { apps: [{ ...sampleApps[0], id: "  " }] },
    { apps: [{ ...sampleApps[0], state: "unknown-state" }] }, { apps: [{ ...sampleApps[0], installationType: "brew" }] },
    { apps: [{ ...sampleApps[0], healthy: "yes" }] }, { apps: [{ ...sampleApps[0], supportedActions: ["rm-rf"] }] },
  ];
  for (const payload of badApps) {
    await assert.rejects(readManagedApps(signal, jsonOf(payload)), /managed apps response is invalid/);
  }
  const badPkgs: unknown[] = [
    null, [], {}, { ...samplePkgs, manager: "brew" }, { ...samplePkgs, source: "remote-refresh" },
    { ...samplePkgs, checkedAt: "   " }, { ...samplePkgs, available: "true" },
    { ...samplePkgs, updates: [{ name: "openssl" }] }, { ...samplePkgs, updates: [{ name: "", candidate: "1.0" }] },
  ];
  for (const payload of badPkgs) {
    await assert.rejects(readPackages(signal, jsonOf(payload)), /package cache response is invalid/);
  }
});

test("HTML fallback and 401/403/429/503 map safely without leaking upstream body", async () => {
  const htmlFetch: typeof fetch = async () => new Response("<html>fallback</html>", { headers: { "Content-Type": "text/html" } });
  for (const run of [() => readManagedApps(signal, htmlFetch), () => readPackages(signal, htmlFetch)]) {
    await assert.rejects(run, (err: unknown) => err instanceof ApiError && err.status === 502 && /API is unavailable/.test(err.message));
  }
  for (const status of [401, 403, 429, 503]) {
    const errFetch: typeof fetch = async () => Response.json({ error: "secret upstream trace" }, { status });
    for (const run of [() => readManagedApps(signal, errFetch), () => readPackages(signal, errFetch)]) {
      await assert.rejects(
        run, (err: unknown) => err instanceof ApiError && err.status === status && !err.message.includes("secret upstream trace"),
      );
    }
  }
});

test("managed-apps controller aborts superseded refresh and honors dispose", async () => {
  const states: ManagedAppsState[] = [];
  let resolveFirst!: (res: Response) => void;
  let firstSignal: AbortSignal | null | undefined;
  let calls = 0;
  const ctrl = createManagedAppsController((s) => states.push(s), async (_url, init) => {
    calls++;
    if (calls === 1) { firstSignal = init?.signal; return new Promise<Response>((r) => { resolveFirst = r; }); }
    return Response.json({ apps: [sampleApps[0]] });
  });
  const first = ctrl.refresh();
  await ctrl.refresh();
  resolveFirst(Response.json({ apps: sampleApps }));
  await first;
  assert.equal(firstSignal?.aborted, true);
  assert.deepEqual(states.at(-1), { kind: "ready", apps: [sampleApps[0]] });
  ctrl.dispose();
  await ctrl.refresh();
  assert.equal(calls, 2);
});

test("packages controller surfaces unavailable state and suppresses late resolution on dispose", async () => {
  const unavailable: PackageUpdateSummary = {
    manager: null, available: false, updates: [], truncated: false, checkedAt: "2026-11-21T19:00:00.000Z",
    source: "local-cache", diagnostic: "No supported package manager found",
  };
  const states: PackagesState[] = [];
  let resolveLate!: (res: Response) => void;
  let lateSignal: AbortSignal | null | undefined;
  let calls = 0;
  const ctrl = createPackagesController((s) => states.push(s), async (_url, init) => {
    calls++;
    if (calls === 1) return Response.json(unavailable);
    lateSignal = init?.signal;
    return new Promise<Response>((r) => { resolveLate = r; });
  });
  await ctrl.refresh();
  assert.equal(states.at(-1)?.kind, "unavailable");
  const pending = ctrl.refresh();
  ctrl.dispose();
  resolveLate(Response.json(samplePkgs));
  await pending;
  await ctrl.refresh();
  assert.equal(lateSignal?.aborted, true);
  assert.equal(calls, 2);
  assert.equal(states.at(-1)?.kind, "loading");
});
