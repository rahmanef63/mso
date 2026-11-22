import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError, createAgentVaultController, readAgentVault, syncAgentVault,
  type AgentVaultView, type AgentVaultViewState,
} from "../src/lib/agent-vault/agent-vault-api.ts";
import {
  createAgentGroupController, readAgentGroups, startGroupRun, stopGroupRun,
  type AgentGroupRun, type AgentGroupsSnapshot, type AgentGroupViewState,
} from "../src/lib/agent-group/agent-group-api.ts";

const signal = new AbortController().signal;
const jsonOf = (body: unknown, status = 200): typeof fetch => async () =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response);

const validVault: AgentVaultView = {
  state: {
    schemaVersion: 1, project: { id: "mso", name: "MSO", path: "/repo/mso" },
    root: "/home/u/.mso/vault/mso", current: "snap-001", refreshedAt: "2026-11-22T08:00:00.000Z",
    snapshots: [{
      id: "snap-001", capturedAt: "2026-11-22T08:00:00.000Z", warnings: ["  trimmed warning  ", ""], truncated: false,
      notes: [
        { path: "Snapshots/snap-001/overview/Beranda.md", title: "Agent progress", kind: "overview", source: "generated" },
        { path: "Snapshots/snap-001/docs/plan.md", title: "Plan", kind: "progress", source: "docs/plan.md" },
      ],
    }],
  },
  note: { path: "Snapshots/snap-001/overview/Beranda.md", content: "# MSO\nPlain text note" },
};

const validRun: AgentGroupRun = {
  id: "run-1", groupId: "grp-1", prompt: "Review architecture", state: "running",
  startedAt: "2026-11-22T08:10:00.000Z", updatedAt: "2026-11-22T08:10:05.000Z",
  turns: [{ round: 1, memberId: "m1", name: "Architect", profile: "architect", text: "Looks solid.", at: "2026-11-22T08:10:05.000Z" }],
};

const validGroups: AgentGroupsSnapshot = {
  revision: 3,
  groups: [{
    id: "grp-1", name: "Core Council", maxRounds: 3, enabled: true,
    createdAt: "2026-11-20T00:00:00.000Z", updatedAt: "2026-11-22T08:00:00.000Z", runs: [validRun],
    members: [
      { id: "m1", name: "Architect", profile: "architect", telegram: { user: "u1", connection: "tg", target: "123" } },
      { id: "m2", name: "Reviewer", profile: "reviewer" },
    ],
  }],
};

test("readAgentVault and syncAgentVault send expected requests and validate DTOs", async () => {
  const bridge = { surface: "rust-host" as const, apiBaseOrigin: "http://127.0.0.1:4173" };
  const readFetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "http://127.0.0.1:4173/api/v1/agent-vault?project=mso&note=Snapshots%2Fsnap-001%2Foverview%2FBeranda.md");
    assert.equal(init?.method, "GET");
    assert.equal(init?.credentials, "include");
    return Response.json(validVault);
  };
  const view = await readAgentVault({ project: "mso", note: "Snapshots/snap-001/overview/Beranda.md" }, signal, readFetcher, bridge);
  assert.equal(view.state.project.name, "MSO");
  assert.deepEqual(view.state.snapshots[0].warnings, ["trimmed warning"]);
  assert.equal(view.note?.content, "# MSO\nPlain text note");

  const syncFetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "/api/v1/agent-vault");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { project: "mso" });
    return Response.json({ state: validVault.state, changed: true });
  };
  const synced = await syncAgentVault("mso", signal, syncFetcher);
  assert.equal(synced.changed, true);
  assert.equal(synced.state.current, "snap-001");
});

test("agent-vault rejects malformed DTOs, HTML responses, and maps 401/403/429/400 errors", async () => {
  const badVaults: unknown[] = [
    null, {}, { state: { ...validVault.state, schemaVersion: 2 } },
    { state: { ...validVault.state, project: { id: "", name: "MSO", path: "/repo" } } },
    { state: { ...validVault.state, snapshots: [{ ...validVault.state.snapshots[0], notes: [{ path: "a", title: "A", kind: "bad", source: "s" }] }] } },
    { state: validVault.state, note: { path: "", content: "x" } },
  ];
  for (const bad of badVaults) await assert.rejects(readAgentVault({}, signal, jsonOf(bad)), /agent vault response is invalid/);
  await assert.rejects(syncAgentVault("mso", signal, jsonOf({ state: validVault.state })), /agent vault response is invalid/);
  await assert.rejects(
    readAgentVault({}, signal, async () => new Response("<html></html>", { headers: { "content-type": "text/html" } })),
    (err: unknown) => err instanceof ApiError && err.status === 502 && /API is unavailable/.test(err.message),
  );
  for (const [status, pattern] of [[401, /Sign in/], [403, /Owner role/], [429, /Too many requests/], [503, /temporarily unavailable/]] as const) {
    await assert.rejects(
      readAgentVault({}, signal, jsonOf({ error: "secret" }, status)),
      (err: unknown) => err instanceof ApiError && err.status === status && pattern.test(err.message),
    );
  }
  await assert.rejects(
    readAgentVault({}, signal, jsonOf({ error: "Select a repository id, name or path" }, 400)),
    (err: unknown) => err instanceof ApiError && err.status === 400 && /Select a repository/.test(err.message),
  );
});

test("createAgentVaultController handles load, note read, sync, 403 forbidden, abort, and dispose", async () => {
  const states: AgentVaultViewState[] = [];
  let call = 0; let pendingSignal: AbortSignal | null | undefined; let resolvePending!: (res: Response) => void;
  const ctrl = createAgentVaultController((s) => states.push(s), async (_url, init) => {
    call++;
    if (call === 1) return Response.json({ state: validVault.state });
    if (call === 2) return Response.json(validVault);
    if (call === 3) return Response.json({ state: validVault.state, changed: true });
    if (call === 4) return Response.json({ error: "owner_required" }, { status: 403 });
    pendingSignal = init?.signal;
    return new Promise<Response>((r) => { resolvePending = r; });
  });
  await ctrl.load({ project: "mso" });
  assert.equal(states.at(-1)?.kind, "ready");
  await ctrl.load({ project: "mso", note: "Snapshots/snap-001/overview/Beranda.md" });
  const afterNote = states.at(-1);
  assert.equal(afterNote?.kind, "ready");
  if (afterNote?.kind === "ready") assert.equal(afterNote.vault.note?.path, "Snapshots/snap-001/overview/Beranda.md");
  await ctrl.sync("mso");
  const afterSync = states.at(-1);
  assert.equal(afterSync?.kind, "ready");
  if (afterSync?.kind === "ready") assert.match(afterSync.notice ?? "", /new snapshot/);
  await ctrl.load({ project: "mso" });
  const forbidden = states.at(-1);
  assert.equal(forbidden?.kind, "error");
  if (forbidden?.kind === "error") assert.equal(forbidden.forbidden, true);
  const inFlight = ctrl.load({ project: "mso" });
  ctrl.dispose();
  assert.equal(pendingSignal?.aborted, true);
  resolvePending(Response.json(validVault));
  await inFlight;
});

test("readAgentGroups, startGroupRun, and stopGroupRun send expected payloads and validate DTOs", async () => {
  const readFetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "/api/v1/agent-groups");
    assert.equal(init?.method, "GET");
    return Response.json(validGroups);
  };
  const snap = await readAgentGroups(signal, readFetcher);
  assert.equal(snap.revision, 3);
  assert.equal(snap.groups[0].members.length, 2);

  const started = await startGroupRun("grp-1", " Discuss tests ", signal, async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { action: "run", id: "grp-1", prompt: "Discuss tests" });
    return Response.json({ ...validRun, id: "run-2", prompt: "Discuss tests", turns: [] });
  });
  assert.equal(started.id, "run-2");

  const stopped = await stopGroupRun("run-2", signal, async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { action: "stop", runId: "run-2" });
    return Response.json({ ...validRun, id: "run-2", state: "stopped", error: "agent_group_stopped" });
  });
  assert.equal(stopped.state, "stopped");
  await assert.rejects(startGroupRun("grp-1", "   ", signal, readFetcher), /Enter a discussion prompt/);
  await assert.rejects(stopGroupRun(" ", signal, readFetcher), /Select an active run/);
});

test("agent-group rejects malformed DTOs, HTML responses, and maps 401/403/409/429 errors", async () => {
  const badGroups: unknown[] = [
    null, {}, { revision: -1, groups: [] },
    { revision: 1, groups: [{ ...validGroups.groups[0], maxRounds: 0 }] },
    { revision: 1, groups: [{ ...validGroups.groups[0], members: [{ id: "m1", name: "A", profile: "p", telegram: { user: "" } }] }] },
    { revision: 1, groups: [{ ...validGroups.groups[0], runs: [{ ...validRun, state: "bogus" }] }] },
  ];
  for (const bad of badGroups) await assert.rejects(readAgentGroups(signal, jsonOf(bad)), /agent group response is invalid/);
  await assert.rejects(
    readAgentGroups(signal, async () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } })),
    (err: unknown) => err instanceof ApiError && err.status === 502 && /API is unavailable/.test(err.message),
  );
  for (const [status, code, pattern] of [
    [401, "unauthorized", /Sign in/], [403, "owner_required", /Owner role/],
    [409, "agent_group_disabled", /disabled/], [429, "rate_limited", /Too many requests/],
  ] as const) {
    await assert.rejects(
      startGroupRun("grp-1", "Hi", signal, jsonOf({ error: code }, status)),
      (err: unknown) => err instanceof ApiError && err.status === status && pattern.test(err.message),
    );
  }
});

test("createAgentGroupController handles refresh, startRun, stopRun, actionError, 403, and dispose", async () => {
  const states: AgentGroupViewState[] = [];
  let call = 0;
  const ctrl = createAgentGroupController((s) => states.push(s), async () => {
    call++;
    if (call === 1) return Response.json(validGroups);
    if (call === 2) return Response.json({ ...validRun, id: "run-9", state: "running", prompt: "Ship it" });
    if (call === 3) return Response.json({ ...validRun, id: "run-9", state: "stopped", prompt: "Ship it" });
    if (call === 4) return Response.json({ error: "agent_group_disabled" }, { status: 409 });
    return Response.json({ error: "owner_required" }, { status: 403 });
  });
  await ctrl.refresh();
  await ctrl.startRun("grp-1", "Ship it");
  const started = states.at(-1);
  assert.equal(started?.kind, "ready");
  if (started?.kind === "ready") assert.equal(started.snapshot.groups[0].runs[0].id, "run-9");
  await ctrl.stopRun("run-9");
  const stopped = states.at(-1);
  assert.equal(stopped?.kind, "ready");
  if (stopped?.kind === "ready") assert.equal(stopped.snapshot.groups[0].runs[0].state, "stopped");
  await ctrl.startRun("grp-1", "Blocked");
  const actionErr = states.at(-1);
  assert.equal(actionErr?.kind, "ready");
  if (actionErr?.kind === "ready") assert.match(actionErr.actionError ?? "", /disabled/);
  await ctrl.refresh();
  const forbidden = states.at(-1);
  assert.equal(forbidden?.kind, "error");
  if (forbidden?.kind === "error") assert.equal(forbidden.forbidden, true);
  ctrl.dispose();
});
