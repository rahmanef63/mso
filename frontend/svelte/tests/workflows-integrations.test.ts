import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError as WorkflowsApiError, createWorkflowsController, readWorkflowGraphs, readWorkflowRuns,
  type WorkflowsState,
} from "../src/lib/workflows/workflows-api.ts";
import {
  ApiError as IntegrationsApiError, canonicalProviderId, createChannelsController, createIntegrationsController,
  readChannels, readIntegrations, testChannel,
  type ChannelsState, type IntegrationsState,
} from "../src/lib/integrations/integrations-api.ts";

const signal = new AbortController().signal;
const jsonOf = (body: unknown): typeof fetch => async () =>
  ({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response);

const sampleGraph = {
  version: 2, id: "wf-1", name: "Nightly Backup", description: "Sync workspace snapshots", status: "active",
  inputs: {}, nodes: [{ id: "n1", name: "Schedule", type: "schedule", position: { x: 0, y: 0 }, config: {} }],
  edges: [], metadata: { tags: ["ops", "backup"], folder: "infra", project: "mso" },
  createdAt: "2026-11-20T00:00:00.000Z", updatedAt: "2026-11-21T12:00:00.000Z", revision: "rev-abc",
};

const sampleRun = {
  id: "0123456789abcdef0123456789abcdef", graphId: "wf-1", graphRevision: "rev-abc", graphName: "Nightly Backup",
  state: "completed", startedAt: "2026-11-21T11:00:00.000Z", updatedAt: "2026-11-21T11:01:00.000Z",
  finishedAt: "2026-11-21T11:01:00.000Z", trigger: { type: "schedule", receivedAt: "2026-11-21T11:00:00.000Z" },
};

const sampleIntegrations = {
  version: 2, user: "default", resolution: "default",
  users: [{ id: "default", label: "Default", isDefault: true, connectionCount: 2 }],
  bindings: {}, variables: {},
  connections: [
    {
      user: "default", id: "prod", label: "Convex Prod", provider: "convex-cloud", source: "direct",
      authMethod: "deployment", scope: "deployment", revision: 2, isDefault: true, missing: [],
      state: "verified", verifiedAt: 1763700000000, lastCheck: { result: "verified", detail: "Deployment reachable" },
      values: { deployKey: "super-secret-do-not-expose" }, secret: "hidden-token",
    },
    {
      user: "default", id: "gh-main", label: "GitHub Main", provider: "github", source: "composio",
      authMethod: "oauth2", scope: "account", revision: 1, isDefault: false, missing: ["token"],
      state: "authorization-required", verifiedAt: null, lastCheck: null,
    },
  ],
};

const sampleChannels = {
  version: 1, revision: 4,
  providers: [{ id: "telegram", title: "Telegram", inbound: "webhook", sendText: true, inboundEvents: true, notes: "Bot API" }],
  credentials: [],
  channels: [
    {
      id: "ch-ops", name: "Ops Alerts", provider: "telegram", credential: { user: "default", connection: "bot-main" },
      enabled: true, defaultTarget: "-100123", workflowId: "wf-1",
      createdAt: "2026-11-20T00:00:00.000Z", updatedAt: "2026-11-21T01:00:00.000Z",
      lastCheck: { at: "2026-11-21T01:00:00.000Z", ok: true, detail: "Bot @mso_bot ready" },
      connection: { state: "verified", label: "Main Bot" },
    },
  ],
};

test("readWorkflowGraphs parses real WorkflowGraph DTO and rejects malformed payloads", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "/api/v1/workflows");
    assert.equal(init?.method, "GET");
    assert.equal(init?.cache, "no-store");
    assert.equal((init?.headers as Record<string, string>)?.Accept, "application/json");
    return Response.json({ graphs: [sampleGraph] });
  };
  const graphs = await readWorkflowGraphs(signal, fetcher);
  assert.equal(graphs.length, 1);
  assert.deepEqual(graphs[0], {
    id: "wf-1", name: "Nightly Backup", description: "Sync workspace snapshots", status: "active",
    nodeCount: 1, edgeCount: 0, tags: ["ops", "backup"], folder: "infra", project: "mso",
    createdAt: "2026-11-20T00:00:00.000Z", updatedAt: "2026-11-21T12:00:00.000Z", revision: "rev-abc",
  });
  for (const bad of [null, [], {}, { graphs: [null] }, { graphs: [{ ...sampleGraph, status: "running" }] }, { graphs: [{ ...sampleGraph, nodes: "bad" }] }]) {
    await assert.rejects(readWorkflowGraphs(signal, jsonOf(bad)), /workflows response is invalid/);
  }
});

test("readWorkflowRuns parses wrapped page and bare array, and fails closed on bad payloads", async () => {
  const bridge = { surface: "rust-host" as const, apiBaseOrigin: "http://127.0.0.1:4173" };
  const page = await readWorkflowRuns(signal, async (input, init) => {
    assert.equal(input, "http://127.0.0.1:4173/api/v1/workflows?runs=1");
    assert.equal(init?.credentials, "include");
    return Response.json({ total: 5, runs: [sampleRun], nextOffset: 1 });
  }, bridge);
  assert.equal(page.total, 5);
  assert.equal(page.nextOffset, 1);
  assert.equal(page.runs[0]?.triggerType, "schedule");

  const bare = await readWorkflowRuns(signal, jsonOf([sampleRun]));
  assert.equal(bare.total, 1);
  assert.equal(bare.runs[0]?.id, sampleRun.id);

  for (const bad of [null, {}, { runs: [null] }, { runs: [{ ...sampleRun, state: "bogus" }] }, { runs: [], total: -1 }]) {
    await assert.rejects(readWorkflowRuns(signal, jsonOf(bad)), /workflow runs response is invalid/);
  }
});

test("readIntegrations canonicalizes convex-cloud to convex and drops secret fields", async () => {
  assert.equal(canonicalProviderId("convex-cloud"), "convex");
  assert.equal(canonicalProviderId("convex"), "convex");
  const snapshot = await readIntegrations(signal, jsonOf(sampleIntegrations));
  assert.equal(snapshot.connections.length, 2);
  assert.equal(snapshot.connections[0]?.provider, "convex");
  assert.equal("values" in (snapshot.connections[0] as Record<string, unknown>), false);
  assert.equal("secret" in (snapshot.connections[0] as Record<string, unknown>), false);
  assert.equal(JSON.stringify(snapshot).includes("super-secret"), false);
  for (const bad of [null, {}, { ...sampleIntegrations, version: 1 }, { ...sampleIntegrations, connections: [{ ...sampleIntegrations.connections[0], source: "ftp" }] }]) {
    await assert.rejects(readIntegrations(signal, jsonOf(bad)), /integrations response is invalid/);
  }
});

test("readChannels parses channelsSnapshot and testChannel posts non-destructive test action", async () => {
  const snap = await readChannels(signal, jsonOf(sampleChannels));
  assert.equal(snap.channels.length, 1);
  assert.equal(snap.channels[0]?.connectionState, "verified");
  assert.equal(snap.providers[0]?.id, "telegram");

  await assert.rejects(testChannel("   ", signal, jsonOf({})), (err: unknown) => err instanceof IntegrationsApiError && err.status === 400);

  const result = await testChannel("ch-ops", signal, async (input, init) => {
    assert.equal(input, "/api/v1/channels");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { action: "test", id: "ch-ops" });
    return Response.json({ ok: true, detail: "Bot @mso_bot verified", channel: { lastCheck: { at: "2026-11-21T02:00:00.000Z", ok: true, detail: "Bot @mso_bot verified" } } });
  });
  assert.deepEqual(result, { ok: true, detail: "Bot @mso_bot verified", checkedAt: "2026-11-21T02:00:00.000Z" });

  for (const bad of [null, {}, { ...sampleChannels, version: 2 }, { ...sampleChannels, channels: [{ ...sampleChannels.channels[0], provider: "irc" }] }]) {
    await assert.rejects(readChannels(signal, jsonOf(bad)), /channels response is invalid/);
  }
  await assert.rejects(testChannel("ch-ops", signal, jsonOf({ ok: "yes" })), /channel test response is invalid/);
});

test("HTML fallback and 401/403/429/502 map safely without leaking upstream error text", async () => {
  const htmlFetch: typeof fetch = async () => new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } });
  for (const run of [
    () => readWorkflowGraphs(signal, htmlFetch), () => readWorkflowRuns(signal, htmlFetch),
    () => readIntegrations(signal, htmlFetch), () => readChannels(signal, htmlFetch), () => testChannel("ch-ops", signal, htmlFetch),
  ]) {
    await assert.rejects(run, (err: unknown) =>
      (err instanceof WorkflowsApiError || err instanceof IntegrationsApiError) && err.status === 502 && /API is unavailable/.test(err.message));
  }
  for (const status of [401, 403, 429, 502]) {
    const errFetch: typeof fetch = async () => Response.json({ error: "secret stack trace" }, { status });
    for (const run of [
      () => readWorkflowGraphs(signal, errFetch), () => readWorkflowRuns(signal, errFetch),
      () => readIntegrations(signal, errFetch), () => readChannels(signal, errFetch), () => testChannel("ch-ops", signal, errFetch),
    ]) {
      await assert.rejects(run, (err: unknown) =>
        (err instanceof WorkflowsApiError || err instanceof IntegrationsApiError) && err.status === status && !err.message.includes("secret stack trace"));
    }
  }
  await assert.rejects(readIntegrations(signal, async () => Response.json({ error: "owner_required" }, { status: 403 })), /Owner role is required/);
});

test("workflows controller switches tabs, aborts superseded loads, and honors dispose", async () => {
  const states: WorkflowsState[] = [];
  let resolveSlow!: (r: Response) => void;
  let slowSignal: AbortSignal | null | undefined;
  let calls = 0;
  const ctrl = createWorkflowsController((s) => states.push(s), async (url, init) => {
    calls++;
    if (calls === 1) { slowSignal = init?.signal; return new Promise<Response>((r) => { resolveSlow = r; }); }
    return String(url).includes("runs=1") ? Response.json({ total: 1, runs: [sampleRun] }) : Response.json({ graphs: [sampleGraph] });
  });
  const first = ctrl.refresh();
  await ctrl.setTab("runs");
  resolveSlow(Response.json({ graphs: [sampleGraph] }));
  await first;
  assert.equal(slowSignal?.aborted, true);
  assert.equal(states.at(-1)?.kind, "ready");
  assert.equal(states.at(-1)?.tab, "runs");
  ctrl.dispose();
  await ctrl.refresh();
  assert.equal(calls, 2);
});

test("integrations and channels controllers surface 403 forbidden and live channel test feedback", async () => {
  const intStates: IntegrationsState[] = [];
  const intCtrl = createIntegrationsController((s) => intStates.push(s), async () => Response.json({ error: "owner_required" }, { status: 403 }));
  await intCtrl.refresh();
  const lastInt = intStates.at(-1);
  assert.equal(lastInt?.kind, "error");
  assert.equal(lastInt?.kind === "error" && lastInt.forbidden, true);

  const chStates: ChannelsState[] = [];
  const chCtrl = createChannelsController((s) => chStates.push(s), async (_url, init) => {
    if (init?.method === "POST") return Response.json({ ok: true, detail: "Connected", channel: { lastCheck: { at: "2026-11-21T03:00:00.000Z", ok: true, detail: "Connected" } } });
    return Response.json(sampleChannels);
  });
  await chCtrl.refresh();
  const ok = await chCtrl.runTest("ch-ops");
  assert.equal(ok, true);
  const last = chStates.at(-1);
  assert.equal(last?.kind, "ready");
  if (last?.kind === "ready") {
    assert.equal(last.tests["ch-ops"]?.status, "ok");
    assert.equal(last.snapshot.channels[0]?.lastCheck?.detail, "Connected");
  }
  chCtrl.dispose();
  assert.equal(await chCtrl.runTest("ch-ops"), false);
});
