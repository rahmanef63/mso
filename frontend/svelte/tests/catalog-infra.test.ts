import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError as CatalogApiError, createAppStoreController, createExtensionsController,
  readAppCatalog, readModularFeatures, readSkills,
  type AppStoreState, type ExtensionsState,
} from "../src/lib/catalog/catalog-api.ts";
import {
  ApiError as InfraApiError, canonicalInfraProviderId, createInfraController, readInfraProviders,
  type InfraState,
} from "../src/lib/infra/infra-api.ts";

const signal = new AbortController().signal;
const jsonOf = (body: unknown): typeof fetch => async () =>
  ({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response);

const sampleCatalog = {
  status: "remote",
  entries: [
    { kind: "managed", id: "postgres" },
    {
      kind: "connected",
      manifest: {
        id: "grafana", name: "Grafana Dashboards",
        description: "Metrics and observability portal", launchUrl: "https://grafana.example.com",
      },
    },
  ],
};

const sampleFeatures = {
  schemaVersion: 1,
  features: [
    { id: "billing-guard", title: "Billing Guard", version: "1.2.0", description: "Spend alerts and caps" },
    { id: "audit-trail", name: "Audit Trail", version: "0.4.1" },
  ],
};

const sampleSkills = {
  skills: [
    { id: "mso-agent-bootstrap", name: "Agent Bootstrap", description: "Safe session bootstrap", source: "builtin", trust: "official" },
  ],
  recipes: [
    { id: "rcp-deploy-check", intent: "Verify deployment readiness", summary: "Run doctor and health checks", successes: 7 },
  ],
};

const sampleInfra = {
  providers: [
    {
      id: "convex-cloud", label: "Convex Cloud", configured: true,
      fields: ["deployKey", "projectSlug"], missing: [],
      secret: "convex-secret-token-never-expose", values: { deployKey: "prod:super-secret-value" },
    },
    {
      id: "cloudflare", label: "Cloudflare", configured: false,
      fields: ["apiToken"], missing: ["apiToken"], apiToken: "cf-raw-secret-never-expose",
    },
  ],
};

test("readAppCatalog parses managed and connected catalog entries and rejects malformed payloads", async () => {
  const snap = await readAppCatalog(signal, async (input, init) => {
    assert.equal(input, "/api/v1/app-catalog");
    assert.equal(init?.method, "GET");
    assert.equal(init?.cache, "no-store");
    return Response.json(sampleCatalog);
  });
  assert.equal(snap.status, "remote");
  assert.equal(snap.entries.length, 2);
  assert.deepEqual(snap.entries[0], { kind: "managed", id: "postgres" });
  assert.deepEqual(snap.entries[1], {
    kind: "connected",
    manifest: {
      id: "grafana", name: "Grafana Dashboards",
      description: "Metrics and observability portal", launchUrl: "https://grafana.example.com",
    },
  });
  for (const bad of [
    null, {}, { status: "cached", entries: [] },
    { status: "stale", entries: [{ kind: "managed", id: "" }] },
    { status: "remote", entries: [{ kind: "connected", manifest: { id: "x" } }] },
  ]) {
    await assert.rejects(readAppCatalog(signal, jsonOf(bad)), /app catalog response is invalid/);
  }
});

test("readModularFeatures and readSkills parse valid DTOs and reject bad schemas", async () => {
  const bridge = { surface: "rust-host" as const, apiBaseOrigin: "http://127.0.0.1:4173" };
  const featSnap = await readModularFeatures(signal, async (input, init) => {
    assert.equal(input, "http://127.0.0.1:4173/api/v1/features");
    assert.equal(init?.credentials, "include");
    return Response.json(sampleFeatures);
  }, bridge);
  assert.equal(featSnap.schemaVersion, 1);
  assert.equal(featSnap.features.length, 2);
  assert.equal(featSnap.features[0]?.title, "Billing Guard");

  for (const bad of [null, {}, { schemaVersion: 2, features: [] }, { schemaVersion: 1, features: [{ id: "a" }] }]) {
    await assert.rejects(readModularFeatures(signal, jsonOf(bad)), /modular features response is invalid/);
  }

  const skillSnap = await readSkills(signal, jsonOf(sampleSkills));
  assert.equal(skillSnap.skills.length, 1);
  assert.equal(skillSnap.skills[0]?.trust, "official");
  assert.equal(skillSnap.recipes.length, 1);
  assert.equal(skillSnap.recipes[0]?.successes, 7);

  const noRecipes = await readSkills(signal, jsonOf({ skills: sampleSkills.skills }));
  assert.deepEqual(noRecipes.recipes, []);

  for (const bad of [null, {}, { skills: [{}] }, { skills: [], recipes: [{ id: "r", intent: "x", successes: -1 }] }]) {
    await assert.rejects(readSkills(signal, jsonOf(bad)), /skills response is invalid/);
  }
});

test("readInfraProviders canonicalizes convex-cloud to convex, merges duplicates, and strips secrets", async () => {
  assert.equal(canonicalInfraProviderId("convex-cloud"), "convex");
  assert.equal(canonicalInfraProviderId("convex"), "convex");
  const snap = await readInfraProviders(signal, jsonOf(sampleInfra));
  assert.equal(snap.providers.length, 2);
  assert.deepEqual(snap.providers[0], {
    id: "convex", label: "Convex", configured: true, fields: ["deployKey", "projectSlug"], missing: [],
  });
  assert.equal(JSON.stringify(snap).includes("super-secret"), false);
  assert.equal(JSON.stringify(snap).includes("never-expose"), false);

  const merged = await readInfraProviders(signal, jsonOf({
    providers: [
      { id: "convex", label: "Convex", configured: false },
      { id: "convex-cloud", label: "Convex Cloud", configured: true, fields: ["deployKey"] },
    ],
  }));
  assert.equal(merged.providers.length, 1);
  assert.equal(merged.providers[0]?.id, "convex");
  assert.equal(merged.providers[0]?.configured, true);

  for (const bad of [null, {}, { providers: [null] }, { providers: [{ id: "x", configured: "yes" }] }]) {
    await assert.rejects(readInfraProviders(signal, jsonOf(bad)), /infrastructure providers response is invalid/);
  }
});

test("HTML fallback and 401/403/429/502 map safely without leaking upstream error text", async () => {
  const htmlFetch: typeof fetch = async () => new Response("<html>signin</html>", { headers: { "Content-Type": "text/html" } });
  for (const run of [
    () => readAppCatalog(signal, htmlFetch), () => readModularFeatures(signal, htmlFetch),
    () => readSkills(signal, htmlFetch), () => readInfraProviders(signal, htmlFetch),
  ]) {
    await assert.rejects(run, (err: unknown) =>
      (err instanceof CatalogApiError || err instanceof InfraApiError) && err.status === 502 && /API is unavailable/.test(err.message));
  }
  for (const status of [401, 403, 429, 502]) {
    const errFetch: typeof fetch = async () => Response.json({ error: "raw upstream secret trace" }, { status });
    for (const run of [
      () => readAppCatalog(signal, errFetch), () => readModularFeatures(signal, errFetch),
      () => readSkills(signal, errFetch), () => readInfraProviders(signal, errFetch),
    ]) {
      await assert.rejects(run, (err: unknown) =>
        (err instanceof CatalogApiError || err instanceof InfraApiError) && err.status === status && !err.message.includes("raw upstream secret trace"));
    }
  }
});

test("controllers handle refresh, tab switching, 403 forbidden flag, and dispose", async () => {
  const storeStates: AppStoreState[] = [];
  const storeCtrl = createAppStoreController((s) => storeStates.push(s), jsonOf(sampleCatalog));
  await storeCtrl.refresh();
  assert.equal(storeStates.at(-1)?.kind, "ready");
  storeCtrl.dispose();

  const extStates: ExtensionsState[] = [];
  const extCtrl = createExtensionsController((s) => extStates.push(s), async (url) =>
    String(url).includes("/api/skills") ? Response.json(sampleSkills) : Response.json(sampleFeatures));
  await extCtrl.refresh();
  assert.equal(extStates.at(-1)?.kind, "ready");
  assert.equal(extStates.at(-1)?.tab, "features");
  await extCtrl.setTab("skills");
  const lastExt = extStates.at(-1);
  assert.equal(lastExt?.kind, "ready");
  if (lastExt?.kind === "ready") assert.equal(lastExt.skills.length, 1);
  extCtrl.dispose();

  const infraStates: InfraState[] = [];
  const infraCtrl = createInfraController((s) => infraStates.push(s), async () => Response.json({ error: "forbidden" }, { status: 403 }));
  await infraCtrl.refresh();
  const lastInfra = infraStates.at(-1);
  assert.equal(lastInfra?.kind, "error");
  assert.equal(lastInfra?.kind === "error" && lastInfra.forbidden, true);
  infraCtrl.dispose();
});
