import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createChannelsWorkspaceController, type ChannelsWorkspaceState,
} from "../src/lib/integrations/channels-workspace.ts";
import { readChannelsWorkspace } from "../src/lib/integrations/channels-api.ts";
import { createInfraWorkspaceController } from "../src/lib/infra/infra-workspace-controller.ts";
import {
  readCloudflareZones, readDokployProjects, readInfraProviderRows, runInfraDoctor,
} from "../src/lib/infra/infra-workspace-api.ts";
import type { InfraWorkspaceState } from "../src/lib/infra/infra-workspace-controller.ts";
import { SIGNAL, channelsPayload, infraPayload, jsonOf } from "./_integrations-fixtures.ts";

test("channels workspace reads channels plus reference lists and degrades them independently", async () => {
  const workspace = await readChannelsWorkspace(SIGNAL(), async (input) => {
    const url = String(input);
    if (url === "/api/v1/channels") return Response.json(channelsPayload);
    if (url === "/api/v1/workflows") {
      return Response.json({
        graphs: [
          { id: "wf-1", name: "Ops inbound", status: "active", nodes: [{ id: "n", type: "channel_trigger" }] },
          { id: "wf-2", name: "Draft graph", status: "draft", nodes: [{ id: "n", type: "channel_trigger" }] },
          { id: "wf-3", name: "No trigger", status: "active", nodes: [{ id: "n", type: "manual" }] },
        ],
      });
    }
    return Response.json({ error: "owner_required" }, { status: 403 });
  });
  assert.equal(workspace.revision, 7);
  assert.equal(workspace.channels.length, 1);
  assert.equal(workspace.credentials[0]?.provider, "telegram");
  assert.deepEqual(workspace.workflows, [{ id: "wf-1", name: "Ops inbound" }]);
  assert.deepEqual(workspace.groups, [], "agent groups degrade to empty when the route fails");

  await assert.rejects(
    readChannelsWorkspace(SIGNAL(), async (input) => (String(input) === "/api/v1/channels"
      ? Response.json({ ...channelsPayload, version: 2 })
      : Response.json({ graphs: [] }))),
    /channels response is invalid/,
  );
});

test("channels workspace controller writes with the live revision and re-reads canonical state", async () => {
  const states: ChannelsWorkspaceState[] = [];
  const writes: Array<Record<string, unknown>> = [];
  let revision = 7;
  const controller = createChannelsWorkspaceController((state) => states.push(state), async (input, init) => {
    const url = String(input);
    if (url !== "/api/v1/channels") return Response.json({ graphs: [] });
    if (init?.method !== "POST") return Response.json({ ...channelsPayload, revision });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    writes.push(body);
    if (body.action === "update" || body.action === "delete") {
      if (body.expectedRevision !== revision) return Response.json({ error: "channel_revision_changed" }, { status: 409 });
      revision += 1;
    }
    if (body.action === "test") {
      return Response.json({ ok: true, detail: "Bot @mso_bot ready", channel: { lastCheck: { at: "2026-02-01T00:00:00.000Z", ok: true, detail: "Bot @mso_bot ready" } } });
    }
    if (body.action === "send") return Response.json({ provider: "telegram", target: "-100123" });
    return Response.json({ ok: true });
  });

  await controller.refresh();
  assert.equal(states.at(-1)?.kind, "ready");

  const saved = await controller.save(null, {
    name: "New", provider: "telegram", credentialUser: "default", credentialConnection: "bot",
    enabled: true, defaultTarget: "", workflowId: "", agentGroupId: "",
  });
  assert.equal(saved, true);
  assert.equal(writes.at(-1)?.action, "create");

  assert.equal(await controller.toggle("ch-1", false), true);
  assert.equal(writes.at(-1)?.expectedRevision, 7, "a write carries the revision the panel last read");
  assert.equal(await controller.runTest("ch-1"), true);
  const afterTest = states.at(-1);
  assert.equal(afterTest?.kind === "ready" && afterTest.tests["ch-1"]?.status, "ok");

  assert.equal(await controller.send("ch-1", "-100123", "hello"), true);
  const afterSend = states.at(-1);
  assert.equal(afterSend?.kind === "ready" && afterSend.tests["ch-1"]?.status, "ok");

  assert.equal(await controller.remove("ch-1"), true);
  assert.equal(writes.at(-1)?.action, "delete");

  controller.dispose();
  assert.equal(await controller.runTest("ch-1"), false);
});

test("channels workspace surfaces a failed write as an error state instead of a silent no-op", async () => {
  const states: ChannelsWorkspaceState[] = [];
  const controller = createChannelsWorkspaceController((state) => states.push(state), async (input, init) => {
    if (String(input) !== "/api/v1/channels") return Response.json({ graphs: [] });
    if (init?.method === "POST") return Response.json({ error: "connection_not_found" }, { status: 400 });
    return Response.json(channelsPayload);
  });
  await controller.refresh();
  const ok = await controller.toggle("ch-1", false);
  assert.equal(ok, false);
  assert.equal(states.at(-1)?.kind, "error");
  controller.dispose();
});

test("infra providers merge convex-cloud into one Convex row and never expose a secret", async () => {
  const rows = await readInfraProviderRows(SIGNAL(), jsonOf(infraPayload));
  const convex = rows.filter((row) => row.id === "convex");
  assert.equal(convex.length, 1);
  assert.equal(convex[0]?.label, "Convex");
  assert.equal(convex[0]?.configured, true);
  assert.equal(convex[0]?.convexKind, "self-hosted");
  assert.deepEqual(convex[0]?.fields, ["apiUrl", "adminKey"]);
  assert.equal(rows.some((row) => row.id === "convex-cloud"), false);
  assert.equal(JSON.stringify(rows).includes("never-expose-this"), false);

  const cloud = await readInfraProviderRows(SIGNAL(), jsonOf({ providers: [{ id: "convex", label: "Convex", configured: true }] }));
  assert.equal(cloud[0]?.convexKind, "cloud");

  for (const bad of [null, {}, { providers: [null] }, { providers: [{ id: "x", configured: "yes" }] }]) {
    await assert.rejects(readInfraProviderRows(SIGNAL(), jsonOf(bad)), /providers response is invalid/);
  }
});

test("dokploy, cloudflare and doctor payloads validate shapes and canonicalize ids", async () => {
  const projects = await readDokployProjects(SIGNAL(), jsonOf({
    projects: [{ projectId: "p1", name: "Prod" }, { projectId: "", name: "Bad" }],
  }));
  assert.deepEqual(projects, [{ projectId: "p1", name: "Prod" }]);
  await assert.rejects(readDokployProjects(SIGNAL(), jsonOf({ nope: [] })), /Dokploy projects response is invalid/);

  const zones = await readCloudflareZones(SIGNAL(), jsonOf({ zones: [{ id: "z1", name: "example.com" }] }));
  assert.deepEqual(zones, [{ id: "z1", name: "example.com" }]);
  await assert.rejects(readCloudflareZones(SIGNAL(), jsonOf({ zones: "bad" })), /Cloudflare zones response is invalid/);

  const doctor = await runInfraDoctor(null, SIGNAL(), async (_input, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), {});
    return Response.json({
      results: [
        { id: "convex-cloud", ok: true, detail: "deployment reachable" },
        { id: "dokploy", ok: null, detail: "not configured" },
        { id: "cloudflare", ok: false, detail: "token rejected" },
      ],
    });
  });
  assert.deepEqual(doctor.map((row) => row.id), ["convex", "dokploy", "cloudflare"]);
  assert.equal(doctor[1]?.ok, null);
  assert.equal(doctor[2]?.ok, false);
});

test("infra workspace controller keeps the tab, loads inventory, and reports doctor results", async () => {
  const states: InfraWorkspaceState[] = [];
  const controller = createInfraWorkspaceController((state) => states.push(state), async (input) => {
    const url = String(input);
    if (url === "/api/v1/infra/providers") return Response.json(infraPayload);
    if (url === "/api/v1/infra/dokploy/projects") return Response.json({ projects: [{ projectId: "p1", name: "Prod" }] });
    if (url === "/api/v1/infra/cloudflare/zones") return Response.json({ zones: [{ id: "z1", name: "example.com" }] });
    if (url === "/api/v1/infra/providers/doctor") return Response.json({ results: [{ id: "dokploy", ok: true, detail: "reachable" }] });
    return Response.json({ error: "not found" }, { status: 404 });
  });

  await controller.refresh();
  const ready = states.at(-1);
  assert.equal(ready?.kind, "ready");
  if (ready?.kind === "ready") {
    assert.equal(ready.projects.length, 1);
    assert.equal(ready.zones.length, 1);
    assert.equal(ready.inventoryError, null);
  }

  const results = await controller.runDoctor(null);
  assert.equal(results.length, 1);
  const afterDoctor = states.at(-1);
  assert.equal(afterDoctor?.kind === "ready" && afterDoctor.doctor.length, 1);

  await controller.setTab("cloudflare");
  assert.equal(states.at(-1)?.tab, "cloudflare");
  controller.dispose();
});

test("infra controller reports a failed inventory read without hiding the provider list", async () => {
  const states: InfraWorkspaceState[] = [];
  const controller = createInfraWorkspaceController((state) => states.push(state), async (input) => {
    const url = String(input);
    if (url === "/api/v1/infra/providers") return Response.json(infraPayload);
    return Response.json({ error: "upstream failed" }, { status: 503 });
  });
  await controller.refresh();
  const ready = states.at(-1);
  assert.equal(ready?.kind, "ready");
  if (ready?.kind === "ready") {
    assert.equal(ready.providers.length, 3);
    assert.match(String(ready.inventoryError), /could not be listed/);
  }
  controller.dispose();
});

test("infra controller surfaces 403 as a forbidden error state", async () => {
  const states: InfraWorkspaceState[] = [];
  const controller = createInfraWorkspaceController((state) => states.push(state),
    async () => Response.json({ error: "Unauthorized" }, { status: 403 }));
  await controller.refresh();
  const last = states.at(-1);
  assert.equal(last?.kind, "error");
  assert.equal(last?.kind === "error" && last.forbidden, true);
  controller.dispose();
});
