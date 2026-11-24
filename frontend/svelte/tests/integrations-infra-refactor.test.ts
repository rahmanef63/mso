import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createIntegrationCatalogController,
  readIntegrationCatalog,
  type IntegrationCatalogState,
} from "../src/lib/integrations/integrations-workspace-api.ts";
import {
  createIntegrationConnection, openIntegrationSetup, saveIntegrationSetup,
  readComposioKeyKind, createComposioSession,
} from "../src/lib/integrations/integrations-setup-api.ts";
import {
  parseTransferDocument, prepareTransferExport, previewTransferImport, readTransferTree,
} from "../src/lib/integrations/integrations-transfer-api.ts";
import {
  buildProviderCards, categoryOf, connectionsFor, filterProviderCards, providerTone,
} from "../src/lib/integrations/integrations-catalog.ts";
import {
  channelHealth, credentialValue, draftDirty, draftValid, healthLabel, inboundPath, splitCredential,
} from "../src/lib/integrations/channels-draft.ts";
import { SIGNAL, SETUP_TOKEN, catalogPayload, jsonOf } from "./_integrations-fixtures.ts";
import {
  channelDraftBase, connections, exportBundlePayload, importPlanPayload, providers, setupGrantPayload,
  setupRequest, transferTreePayload,
} from "./integrations-infra-refactor-fixtures.ts";

test("catalog collapses the retired convex-cloud alias into one Convex provider", async () => {
  const catalog = await readIntegrationCatalog(SIGNAL(), jsonOf(catalogPayload));
  const convex = catalog.filter((provider) => provider.id === "convex");
  assert.equal(convex.length, 1);
  assert.equal(convex[0]?.sources.length, 2);
  assert.equal(catalog.some((provider) => provider.id === "convex-cloud"), false);
  assert.deepEqual(catalog.map((provider) => provider.id).sort(), ["composio", "convex"]);

  for (const bad of [
    null, {}, { catalog: [null] },
    { catalog: [{ id: "x", title: "X", description: "", sources: [{ id: "ftp", label: "x", methods: [] }] }] },
    { catalog: [{ id: "x", title: "X", description: "", sources: [] }] },
  ]) {
    await assert.rejects(readIntegrationCatalog(SIGNAL(), jsonOf(bad)), /catalog response is invalid/);
  }
});

test("catalog controller aborts superseded reads, maps 403, and honours dispose", async () => {
  const states: IntegrationCatalogState[] = [];
  let calls = 0;
  const controller = createIntegrationCatalogController((state) => states.push(state), async () => {
    calls++;
    if (calls === 1) return Response.json(catalogPayload);
    return Response.json({ error: "owner_required" }, { status: 403 });
  });
  await controller.refresh();
  assert.equal(states.at(-1)?.kind, "ready");
  await controller.refresh();
  const forbidden = states.at(-1);
  assert.equal(forbidden?.kind, "error");
  assert.equal(forbidden?.kind === "error" && forbidden.forbidden, true);
  controller.dispose();
  await controller.refresh();
  assert.equal(calls, 2);
});

test("provider cards, categories and filters agree with the connection list", () => {
  assert.equal(categoryOf("convex-cloud"), "cloud");
  assert.equal(categoryOf("telegram"), "messaging");
  assert.equal(categoryOf("unknown-provider"), "other");

  const cards = buildProviderCards(providers, connections);
  const convex = cards.find((card) => card.id === "convex")!;
  assert.equal(convex.connected, 2);
  assert.equal(convex.healthy, false);
  assert.equal(providerTone(convex), "warn");
  assert.equal(cards.find((card) => card.id === "telegram")!.healthy, false);
  assert.equal(cards[0]?.id, "convex");

  assert.equal(filterProviderCards(cards, "messaging", "").length, 1);
  assert.equal(filterProviderCards(cards, "all", "connected").length, 2);
  assert.equal(filterProviderCards(cards, "all", "no-such-provider").length, 0);
  assert.equal(connectionsFor("convex-cloud", connections).length, 2);
});

test("setup grant validates the token, schema and field payload before use", async () => {
  const grant = await openIntegrationSetup(setupRequest, SIGNAL(), async (input, init) => {
    assert.equal(input, "/api/v1/infra/setup");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), setupRequest);
    return Response.json(setupGrantPayload(SETUP_TOKEN));
  });
  assert.equal(grant.schema.provider, "convex");
  assert.equal(grant.schema.methodId, "team");
  assert.deepEqual(grant.schema.steps, ["Open Convex team settings."]);
  assert.equal(grant.schema.fields[0]?.stored, true);

  await assert.rejects(
    openIntegrationSetup({ provider: "convex", method: "team", user: "u", connection: "c" }, SIGNAL(), jsonOf({ token: "short", setup: {} })),
    /secure setup response is invalid/,
  );
});

test("saveIntegrationSetup refuses a malformed grant, empty values, and reports verification honestly", async () => {
  await assert.rejects(saveIntegrationSetup("bad", { teamToken: "x" }, SIGNAL(), jsonOf({})), /no longer valid/);
  await assert.rejects(saveIntegrationSetup(SETUP_TOKEN, { teamToken: "   " }, SIGNAL(), jsonOf({})), /at least one credential value/);

  const result = await saveIntegrationSetup(SETUP_TOKEN, { teamToken: "  secret  " }, SIGNAL(), async (input, init) => {
    assert.equal(input, "/api/integrations/setup");
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${SETUP_TOKEN}`);
    assert.deepEqual(JSON.parse(String(init?.body)), { action: "save", values: { teamToken: "secret" } });
    return Response.json({ ok: true, verified: true, provider: "convex" });
  });
  assert.deepEqual(result, { verified: true, provider: "convex" });

  const unverified = await saveIntegrationSetup(SETUP_TOKEN, { appId: "asdk_app_x" }, SIGNAL(),
    jsonOf({ ok: true, verified: false, provider: "openai-app" }));
  assert.equal(unverified.verified, false);

  await assert.rejects(
    saveIntegrationSetup(SETUP_TOKEN, { teamToken: "x" }, SIGNAL(), jsonOf({ ok: false })),
    /secure setup save response is invalid/,
  );
});

test("createIntegrationConnection sends a confirmed manage action and rejects unsafe ids", async () => {
  await assert.rejects(
    createIntegrationConnection({
      user: "default", provider: "convex", connection: "../etc", label: "x", authMethod: "team", makeDefault: false,
    }, SIGNAL(), jsonOf({ ok: true })),
    /Invalid connection id/,
  );
  const payload = await createIntegrationConnection({
    user: "default", provider: "convex", connection: "prod", label: "Prod", authMethod: "team", makeDefault: true,
  }, SIGNAL(), async (input, init) => {
    assert.equal(input, "/api/v1/integrations");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.mode, "manage");
    assert.equal(body.action, "connection.create");
    assert.equal(body.confirm, true);
    assert.equal(body.makeDefault, true);
    return Response.json({ ok: true });
  });
  assert.equal(payload, undefined);
});

test("Composio key kind and session accept Connect keys and reject a non-Composio host", async () => {
  const kind = await readComposioKeyKind("default", "composio", SIGNAL(), async (input) => {
    assert.match(String(input), /\/api\/v1\/integrations\/composio\/session\?user=default&connection=composio/);
    return Response.json({ keyKind: "connect" });
  });
  assert.equal(kind, "connect");
  assert.equal(await readComposioKeyKind("default", "composio", SIGNAL(), jsonOf({ keyKind: null })), null);
  await assert.rejects(readComposioKeyKind("default", "c", SIGNAL(), jsonOf({ keyKind: "bogus" })), /Composio response is invalid/);

  const session = await createComposioSession("default", "composio", true, SIGNAL(), async (_input, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { user: "default", connection: "composio", refresh: true });
    return Response.json({ mcpUrl: "https://connect.composio.dev/mcp?session=abc", expiresAt: 1234 });
  });
  assert.equal(session.expiresAt, 1234);
  assert.match(session.mcpUrl, /^https:\/\/connect\.composio\.dev\//);

  await assert.rejects(
    createComposioSession("default", "composio", false, SIGNAL(), jsonOf({ mcpUrl: "https://evil.example.com/mcp" })),
    /Composio response is invalid/,
  );
});

test("transfer tree, export and import preview never surface a credential value", async () => {
  const tree = await readTransferTree(SIGNAL(), async (_input, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { action: "tree" });
    return Response.json(transferTreePayload);
  });
  assert.equal(tree[0]?.providers[0]?.id, "convex");

  const exportPreview = await prepareTransferExport(SIGNAL(), jsonOf(exportBundlePayload));
  assert.equal(exportPreview.users, 1);
  assert.equal(exportPreview.connections, 1);
  assert.equal(exportPreview.json.includes("super-secret"), false);
  assert.match(exportPreview.json, /\[redacted\]/);

  await assert.rejects(prepareTransferExport(SIGNAL(), jsonOf({ bundle: { mode: "secrets" } })), /Encrypted bundles cannot be previewed/);

  const preview = await previewTransferImport({ users: [] }, SIGNAL(), async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.apply, false);
    assert.equal(body.action, "import");
    return Response.json(importPlanPayload);
  });
  assert.deepEqual(preview, {
    planId: "plan-1", canApply: true, connections: 1, createUsers: 1, warnings: 1, requiresWarningAcceptance: true,
  });
});

test("parseTransferDocument fails locally on empty, oversized, malformed and non-object documents", () => {
  assert.deepEqual(parseTransferDocument('{"users":[]}'), { users: [] });
  assert.throws(() => parseTransferDocument("   "), /Paste a bundle document first/);
  assert.throws(() => parseTransferDocument("{oops"), /not valid JSON/);
  assert.throws(() => parseTransferDocument("[1,2]"), /must be a JSON object/);
  assert.throws(() => parseTransferDocument(`{"a":"${"x".repeat(1024 * 1024)}"}`), /larger than the 1 MiB/);
});

test("channel draft helpers keep one health vocabulary and reject partial credentials", () => {
  assert.equal(credentialValue("default", "bot"), "default::bot");
  assert.deepEqual(splitCredential("default::bot"), { user: "default", connection: "bot" });
  assert.equal(splitCredential("nope"), null);
  assert.equal(splitCredential("::bot"), null);

  assert.equal(channelHealth({ enabled: false, connectionState: "verified", connectionError: null, lastCheckOk: true }), "disabled");
  assert.equal(channelHealth({ enabled: true, connectionState: "missing", connectionError: null, lastCheckOk: null }), "error");
  assert.equal(channelHealth({ enabled: true, connectionState: "verified", connectionError: null, lastCheckOk: null }), "connected");
  assert.equal(channelHealth({ enabled: true, connectionState: "configured", connectionError: null, lastCheckOk: false }), "error");
  assert.equal(channelHealth({ enabled: true, connectionState: "incomplete", connectionError: null, lastCheckOk: null }), "needs-setup");
  assert.equal(healthLabel("needs-setup"), "Needs setup");
  assert.equal(inboundPath("discord", "abc"), "/api/v1/channels/discord/abc");

  const base = channelDraftBase;
  assert.equal(draftDirty(base, { ...base }), false);
  assert.equal(draftDirty({ ...base, enabled: false }, base), true);
  assert.equal(draftValid(base), true);
  assert.equal(draftValid({ ...base, name: "  " }), false);
  assert.equal(draftValid({ ...base, credential: "" }), false);
});
