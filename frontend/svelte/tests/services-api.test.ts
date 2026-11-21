import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError, createServicesController, isSupervisorUnavailable, readServices, runServiceAction,
  type ServiceInventory, type ServicesState, type SystemService,
} from "../src/lib/monitor/services-api.ts";

const svcA: SystemService = {
  unit: "mso.service", scope: "user", load: "loaded", active: "active", sub: "running",
  description: "MSO control plane", controllable: true,
};
const svcB: SystemService = {
  unit: "nginx.service", scope: "system", load: "loaded", active: "inactive", sub: "dead",
  description: "Web server", controllable: false,
};
const inv: ServiceInventory = {
  services: [svcA, svcB], diagnostics: [], truncated: false,
  controlAllowlistConfigured: true, generatedAt: "2026-11-21T18:00:00.000Z",
};
const signal = new AbortController().signal;
const jsonOf = (body: unknown): typeof fetch => async () =>
  ({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response);

test("readServices fetches uncached JSON and parses real ServiceInventory DTO", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "/api/v1/sys/services");
    assert.equal(init?.method, "GET");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store");
    return Response.json(inv);
  };
  assert.deepEqual(await readServices(signal, fetcher), inv);
});

test("unavailable supervisor DTO transitions controller to unavailable state", async () => {
  const unavailable: ServiceInventory = {
    services: [], diagnostics: ["user services unavailable: no bus", "system services unavailable: ENOENT"],
    truncated: false, controlAllowlistConfigured: false, generatedAt: "2026-11-21T18:00:00.000Z",
  };
  assert.equal(isSupervisorUnavailable(unavailable), true);
  const states: ServicesState[] = [];
  const ctrl = createServicesController((s) => states.push(s), async () => Response.json(unavailable));
  await ctrl.refresh();
  assert.equal(states.at(-1)?.kind, "unavailable");
  ctrl.dispose();
});

test("malformed inventory payloads and wildcards fail closed", async () => {
  const bad: unknown[] = [
    null, [], {}, { ...inv, services: [{ ...svcA, unit: "*.service" }] },
    { ...inv, services: [{ ...svcA, scope: "root" }] }, { ...inv, services: [{ ...svcA, controllable: "yes" }] },
    { ...inv, diagnostics: [42] }, { ...inv, generatedAt: "   " },
  ];
  for (const payload of bad) {
    await assert.rejects(readServices(signal, jsonOf(payload)), /service inventory response is invalid/);
  }
  await assert.rejects(
    runServiceAction({ scope: "user", unit: "*.service", action: "restart" }, signal, jsonOf(svcA)),
    (err: unknown) => err instanceof ApiError && err.status === 400,
  );
});

test("HTML fallback is rejected as unavailable API", async () => {
  await assert.rejects(
    readServices(signal, async () => new Response("<html>fallback</html>", { headers: { "Content-Type": "text/html" } })),
    (err: unknown) => err instanceof ApiError && err.status === 502 && /API is unavailable/.test(err.message),
  );
});

test("401, 403, 409, and 500 map safely without leaking upstream body", async () => {
  for (const status of [401, 403, 409, 500]) {
    await assert.rejects(
      runServiceAction({ scope: "user", unit: "mso.service", action: "restart" }, signal,
        async () => Response.json({ error: "secret upstream trace" }, { status })),
      (err: unknown) => err instanceof ApiError && err.status === status && !err.message.includes("secret upstream trace"),
    );
  }
});

test("runServiceAction posts exact scope/unit/action payload via shell bridge", async () => {
  const bridge = { surface: "rust-host" as const, apiBaseOrigin: "http://127.0.0.1:4173" };
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "http://127.0.0.1:4173/api/v1/sys/services");
    assert.equal(init?.method, "POST");
    assert.equal(init?.credentials, "include");
    assert.deepEqual(JSON.parse(String(init?.body)), { scope: "user", unit: "mso.service", action: "restart" });
    return Response.json(svcA);
  };
  assert.deepEqual(await runServiceAction({ scope: "user", unit: "mso.service", action: "restart" }, signal, fetcher, bridge), svcA);
});

test("controller trigger refreshes inventory and guards refresh/dispose races", async () => {
  const states: ServicesState[] = [];
  let resolveSlow!: (res: Response) => void;
  let slowSignal: AbortSignal | null | undefined;
  let calls = 0;
  const ctrl = createServicesController((s) => states.push(s), async (_url, init) => {
    calls++;
    if (calls === 1) return Response.json(inv);
    if (calls === 2) { assert.equal(init?.method, "POST"); return Response.json(svcA); }
    if (calls === 3) return Response.json({ ...inv, services: [svcA] });
    slowSignal = init?.signal;
    return new Promise<Response>((r) => { resolveSlow = r; });
  });
  await ctrl.refresh();
  await ctrl.trigger("user", "mso.service", "restart");
  const afterTrigger = states.at(-1);
  assert.equal(afterTrigger?.kind, "ready");
  assert.equal(afterTrigger?.inventory.services.length, 1);
  assert.equal(afterTrigger?.notice, "Completed restart on mso.service.");
  const late = ctrl.refresh();
  ctrl.dispose();
  resolveSlow(Response.json(inv));
  await late;
  await ctrl.refresh();
  assert.equal(slowSignal?.aborted, true);
  assert.equal(calls, 4);
  assert.equal(states.at(-1)?.kind, "loading");
});
