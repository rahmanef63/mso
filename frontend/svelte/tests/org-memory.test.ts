import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError, createOrganizationController, readOrganization,
  type OrganizationSnapshot, type OrganizationState,
} from "../src/lib/organization/org-api.ts";
import {
  createMemoryGraphController, readMemoryGraph,
  type MemoryGraphDocument, type MemoryGraphState,
} from "../src/lib/memory-graph/memory-graph-api.ts";

const signal = new AbortController().signal;
const jsonOf = (body: unknown): typeof fetch => async () =>
  ({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response);

const validOrg: OrganizationSnapshot = {
  chart: {
    version: 1, name: "MSO Fleet", revision: "rev-2026-11-21", updatedAt: "2026-11-21T18:00:00.000Z",
    units: [{
      id: "u1", key: "core", name: "Core Engineering", kind: "team", status: "active",
      parentUnitId: "root", description: "Platform team", sortOrder: 1,
      createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-21T00:00:00.000Z",
    }],
    seats: [
      {
        id: "s1", unitId: "u1", name: "Architect", title: "Lead Architect", role: "engineer",
        state: "active", seatMode: "permanent", reportsToSeatId: "s0", description: "System design",
        responsibilities: ["  Architecture  ", "", "Security"],
        target: { kind: "project-agent", project: "mso" }, sortOrder: 1,
        createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-21T00:00:00.000Z",
      },
      {
        id: "s2", unitId: "u1", name: "Ops", title: "Operator", role: "ops",
        state: "vacant", seatMode: "on_demand", responsibilities: [],
        target: { kind: "local-agent", ref: "agent:ops" }, sortOrder: 2,
        createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-21T00:00:00.000Z",
      },
      {
        id: "s3", unitId: "u1", name: "Unbound", title: "Advisor", role: "advisor",
        state: "inactive", seatMode: "inactive", responsibilities: [],
        target: { kind: "none" }, sortOrder: 3,
        createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-21T00:00:00.000Z",
      },
    ],
  },
  runtime: [{ seatId: "s1", targetKind: "project-agent", status: "ready", label: "mso", detail: "Online" }],
};

const validGraph: MemoryGraphDocument = {
  nodes: [
    {
      id: "n1", title: "Architecture Note", kind: "note", group: "docs", degree: 2,
      path: "docs/ARCHITECTURE.md", excerpt: "Core boundaries", targetApp: "workflows", origin: "vault",
    },
    { id: "n2", title: "Ghost Ref", kind: "ghost", group: "unlinked", degree: 1 },
  ],
  edges: [{ source: "n1", target: "n2", kind: "wikilink", resolved: false }],
  truncated: false, warnings: ["  minor warning  ", ""], root: "/vault",
  counts: { notes: 1, memories: 0, ghosts: 1 },
};

test("readOrganization fetches JSON and validates OrganizationSnapshot DTO", async () => {
  const bridge = { surface: "rust-host" as const, apiBaseOrigin: "http://127.0.0.1:4173" };
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "http://127.0.0.1:4173/api/v1/organization");
    assert.equal(init?.method, "GET");
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    return Response.json(validOrg);
  };
  const snap = await readOrganization(signal, fetcher, bridge);
  assert.equal(snap.chart.name, "MSO Fleet");
  assert.deepEqual(snap.chart.seats[0].responsibilities, ["Architecture", "Security"]);
  assert.equal(snap.runtime[0].status, "ready");
});

test("readOrganization rejects malformed DTOs, HTML responses, and maps 401/403/429/503 errors", async () => {
  const badPayloads: unknown[] = [
    null, {}, { chart: { ...validOrg.chart, version: 2 }, runtime: [] },
    { chart: { ...validOrg.chart, units: [{ ...validOrg.chart.units[0], kind: "bad" }] }, runtime: [] },
    { chart: { ...validOrg.chart, seats: [{ ...validOrg.chart.seats[0], target: { kind: "project-agent", project: "" } }] }, runtime: [] },
    { chart: { ...validOrg.chart, seats: [{ ...validOrg.chart.seats[0], target: { kind: "a2a", ref: "  " } }] }, runtime: [] },
    { chart: validOrg.chart, runtime: [{ seatId: "s1", targetKind: "none", status: "unknown" }] },
  ];
  for (const bad of badPayloads) {
    await assert.rejects(readOrganization(signal, jsonOf(bad)), /organization response is invalid/);
  }
  await assert.rejects(
    readOrganization(signal, async () => new Response("<html></html>", { headers: { "content-type": "text/html" } })),
    (err: unknown) => err instanceof ApiError && err.status === 502 && /API is unavailable/.test(err.message),
  );
  for (const [status, pattern] of [[401, /Sign in/], [403, /permission/], [429, /Too many requests/], [503, /temporarily unavailable/]] as const) {
    await assert.rejects(
      readOrganization(signal, async () => Response.json({ error: "internal" }, { status })),
      (err: unknown) => err instanceof ApiError && err.status === status && pattern.test(err.message),
    );
  }
});

test("createOrganizationController handles refresh, 403 forbidden flag, abort, and dispose", async () => {
  const states: OrganizationState[] = [];
  let call = 0;
  let slowSignal: AbortSignal | null | undefined;
  let resolveSlow!: (res: Response) => void;
  const ctrl = createOrganizationController((s) => states.push(s), async (_url, init) => {
    call++;
    if (call === 1) return Response.json(validOrg);
    if (call === 2) return Response.json({ error: "denied" }, { status: 403 });
    slowSignal = init?.signal;
    return new Promise<Response>((r) => { resolveSlow = r; });
  });
  await ctrl.refresh();
  assert.equal(states.at(-1)?.kind, "ready");
  await ctrl.refresh();
  const errState = states.at(-1);
  assert.equal(errState?.kind, "error");
  if (errState?.kind === "error") assert.equal(errState.forbidden, true);

  const pending = ctrl.refresh();
  ctrl.dispose();
  assert.equal(slowSignal?.aborted, true);
  resolveSlow(Response.json(validOrg));
  await pending;
  const countAfterDispose = states.length;
  await ctrl.refresh();
  assert.equal(states.length, countAfterDispose);
});

test("readMemoryGraph fetches JSON and validates MemoryGraphDocument DTO", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "/api/v1/memory-graph");
    assert.equal(init?.credentials, "same-origin");
    return Response.json(validGraph);
  };
  const doc = await readMemoryGraph(signal, fetcher);
  assert.equal(doc.nodes.length, 2);
  assert.deepEqual(doc.warnings, ["minor warning"]);
  assert.equal(doc.edges[0].resolved, false);
});

test("readMemoryGraph rejects malformed DTOs, HTML responses, and maps 401/403/429/502 errors", async () => {
  const badPayloads: unknown[] = [
    null, {}, { ...validGraph, nodes: [{ ...validGraph.nodes[0], kind: "invalid" }] },
    { ...validGraph, nodes: [{ ...validGraph.nodes[0], degree: -1 }] },
    { ...validGraph, nodes: [{ ...validGraph.nodes[0], targetApp: "unknown" }] },
    { ...validGraph, edges: [{ source: "n1", target: "n2", kind: "bad", resolved: true }] },
    { ...validGraph, counts: { notes: 1, memories: -1, ghosts: 0 } },
  ];
  for (const bad of badPayloads) {
    await assert.rejects(readMemoryGraph(signal, jsonOf(bad)), /memory graph response is invalid/);
  }
  await assert.rejects(
    readMemoryGraph(signal, async () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } })),
    (err: unknown) => err instanceof ApiError && err.status === 502 && /API is unavailable/.test(err.message),
  );
  for (const [status, pattern] of [[401, /Sign in/], [403, /Owner role/], [429, /Too many requests/], [502, /temporarily unavailable/]] as const) {
    await assert.rejects(
      readMemoryGraph(signal, async () => Response.json({ error: "secret" }, { status })),
      (err: unknown) => err instanceof ApiError && err.status === status && pattern.test(err.message),
    );
  }
});

test("createMemoryGraphController handles refresh, 403 forbidden flag, abort supersede, and dispose", async () => {
  const states: MemoryGraphState[] = [];
  let call = 0;
  let firstSignal: AbortSignal | null | undefined;
  let resolveFirst!: (res: Response) => void;
  const ctrl = createMemoryGraphController((s) => states.push(s), async (_url, init) => {
    call++;
    if (call === 1) {
      firstSignal = init?.signal;
      return new Promise<Response>((r) => { resolveFirst = r; });
    }
    if (call === 2) return Response.json(validGraph);
    return Response.json({}, { status: 403 });
  });
  const firstRun = ctrl.refresh();
  const secondRun = ctrl.refresh();
  assert.equal(firstSignal?.aborted, true);
  resolveFirst(Response.json(validGraph));
  await Promise.all([firstRun, secondRun]);
  assert.equal(states.at(-1)?.kind, "ready");

  await ctrl.refresh();
  const errState = states.at(-1);
  assert.equal(errState?.kind, "error");
  if (errState?.kind === "error") assert.equal(errState.forbidden, true);
  ctrl.dispose();
});
