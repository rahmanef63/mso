import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCatalogCards,
  CATALOG_CATEGORIES,
  catalogStatusTone,
  classifyConnected,
  featureHeading,
  filterCatalogCards,
  formatIntegrity,
  integrityTone,
  marketStateTone,
  matchesCard,
  safeExternalUrl,
  sortCatalogCards,
  trustTone,
  type CatalogCard,
} from "../src/lib/catalog/catalog-model.ts";
import {
  ApiError as MarketApiError,
  createSkillMarketController,
  matchesMarketRow,
  parseSkillMarket,
  readSkillMarket,
  type SkillMarketState,
} from "../src/lib/catalog/catalog-market.ts";
import type { AppCatalogSnapshot, ModularFeatureSummary } from "../src/lib/catalog/catalog-api.ts";

const signal = new AbortController().signal;
const jsonFetch = (body: unknown): typeof fetch => async () =>
  ({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response);

const snapshot: AppCatalogSnapshot = {
  status: "remote",
  entries: [
    { kind: "managed", id: "n8n" },
    { kind: "managed", id: "hermes" },
    {
      kind: "connected",
      manifest: {
        id: "grafana", name: "Grafana Dashboards",
        description: "Metrics and observability portal", launchUrl: "https://grafana.example.com",
      },
    },
  ],
};

const marketPayload = {
  root: "/home/operator/.mso/skills",
  skills: [
    {
      id: "ponytail", title: "Ponytail", description: "Minimalist senior-dev coding mode.",
      version: "4.9.0", source: "@dietrichgebert/ponytail", security: "clean",
      state: "not-installed", canInstall: true, canRemove: false,
    },
    {
      id: "rtk", title: "RTK", description: "Compress verbose shell output.",
      version: "1", source: "mso-curated/rtk", security: "mso-safe-wrapper",
      state: "installed", canInstall: true, canRemove: true,
    },
  ],
};

test("safeExternalUrl admits only absolute http(s) URLs without credentials", () => {
  assert.equal(safeExternalUrl("https://grafana.example.com/dash"), "https://grafana.example.com/dash");
  assert.equal(safeExternalUrl("http://127.0.0.1:4005"), "http://127.0.0.1:4005/");
  for (const bad of [
    "javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "//evil.example.com",
    "https://user:pass@evil.example.com", "", "   ", null, undefined,
  ]) assert.equal(safeExternalUrl(bad), null, `expected null for ${String(bad)}`);
});

test("buildCatalogCards titles managed adapters, classifies connected apps, and spotlights one entry", () => {
  const cards = buildCatalogCards(snapshot);
  assert.equal(cards.length, 3);
  const byKey = new Map(cards.map((card) => [card.key, card]));
  assert.equal(byKey.get("managed:hermes")?.title, "Hermes Agent");
  assert.equal(byKey.get("managed:hermes")?.category, "ai-agents");
  assert.equal(byKey.get("managed:n8n")?.category, "automation");
  assert.equal(byKey.get("connected:grafana")?.kindLabel, "Connected App");
  assert.equal(byKey.get("connected:grafana")?.meta, "grafana.example.com");
  assert.equal(cards.filter((card) => card.spotlight).length, 1);
  assert.equal(cards.find((card) => card.spotlight)?.kind, "managed");
});

test("unknown managed ids and unsafe launch URLs degrade without leaking or throwing", () => {
  const cards = buildCatalogCards({
    status: "stale",
    entries: [
      { kind: "managed", id: "custom-thing" },
      { kind: "connected", manifest: { id: "sketchy", name: "Sketchy", launchUrl: "javascript:alert(1)" } },
    ],
  });
  const managed = cards.find((card) => card.id === "custom-thing");
  assert.equal(managed?.title, "custom-thing");
  assert.equal(managed?.category, "productivity");
  const connected = cards.find((card) => card.id === "sketchy");
  assert.equal(connected?.launchUrl, null);
  assert.equal(connected?.meta, "external provider");
});

test("filterCatalogCards honours category pills, kind pills, and the search box", () => {
  const cards = buildCatalogCards(snapshot);
  const ids = (list: CatalogCard[]) => list.map((card) => card.key).sort();
  assert.equal(filterCatalogCards(cards, "", "all").length, 3);
  assert.deepEqual(ids(filterCatalogCards(cards, "", "managed")), ["managed:hermes", "managed:n8n"]);
  assert.deepEqual(ids(filterCatalogCards(cards, "", "connected")), ["connected:grafana"]);
  assert.deepEqual(ids(filterCatalogCards(cards, "", "automation")), ["managed:n8n"]);
  assert.deepEqual(ids(filterCatalogCards(cards, "grafana", "all")), ["connected:grafana"]);
  assert.deepEqual(filterCatalogCards(cards, "no-such-app", "all"), []);
  const hermes = cards.find((card) => card.id === "hermes");
  assert.ok(hermes && matchesCard(hermes, "  HERMES  "));
  assert.ok(hermes && matchesCard(hermes, "ai-agents"));
});

test("sortCatalogCards keeps curated order, sorts by name, and groups managed first", () => {
  const cards = buildCatalogCards(snapshot);
  assert.deepEqual(sortCatalogCards(cards, "curated").map((c) => c.id), ["n8n", "hermes", "grafana"]);
  assert.deepEqual(sortCatalogCards(cards, "name").map((c) => c.title),
    ["Grafana Dashboards", "Hermes Agent", "n8n"]);
  const byKind = sortCatalogCards(cards, "kind");
  assert.deepEqual(byKind.map((c) => c.kind), ["managed", "managed", "connected"]);
  assert.equal(cards[0]?.key, "managed:n8n", "sorting must not mutate the caller's array");
});

test("classifyConnected buckets by text hints and falls back to productivity", () => {
  assert.equal(classifyConnected("stripe", "Payments dashboard"), "productivity");
  assert.equal(classifyConnected("claude", "Coding agent workspace"), "ai-agents");
  assert.equal(classifyConnected("zapier", "Workflow automation hub"), "automation");
});

test("badge helpers map statuses, trust tiers, market states, and digests to tones", () => {
  assert.equal(catalogStatusTone("remote"), "ok");
  assert.equal(catalogStatusTone("stale"), "warn");
  assert.equal(catalogStatusTone("unavailable"), "danger");
  for (const tier of ["official", "verified", "trusted", "builtin"]) assert.equal(trustTone(tier), "ok");
  for (const tier of ["local", "community", "review"]) assert.equal(trustTone(tier), "warn");
  assert.equal(trustTone("untrusted"), "danger");
  assert.equal(trustTone("blocked"), "danger");
  assert.equal(trustTone("unknown-tier"), "neutral");
  assert.equal(marketStateTone("installed"), "ok");
  assert.equal(marketStateTone("modified"), "warn");
  assert.equal(marketStateTone("conflict"), "danger");
  assert.equal(marketStateTone("update-available"), "neutral");
  const digest = `sha256-${"a".repeat(64)}`;
  assert.equal(formatIntegrity(digest), "sha256:aaaaaaaaaaaa");
  assert.equal(integrityTone(digest), "ok");
  assert.equal(formatIntegrity("sha256-short"), null);
  assert.equal(integrityTone(undefined), "warn");
});

test("featureHeading prefers title, then name, then id", () => {
  const base: ModularFeatureSummary = { id: "pkg", version: "1.0.0" };
  assert.equal(featureHeading({ ...base, title: "Package", name: "pkg-name" }), "Package");
  assert.equal(featureHeading({ ...base, name: "pkg-name" }), "pkg-name");
  assert.equal(featureHeading(base), "pkg");
});

test("parseSkillMarket validates rows and rejects malformed payloads without leaking", () => {
  const snap = parseSkillMarket(marketPayload);
  assert.equal(snap.skills.length, 2);
  assert.equal(snap.root, "/home/operator/.mso/skills");
  assert.equal(snap.skills[0]?.canInstall, true);

  for (const bad of [
    null, {}, { skills: "nope" },
    { skills: [{ id: "x" }] },
    { skills: [{ id: "x", title: "t", description: "d", version: "1", source: "s", security: "c", state: "installed", canInstall: "yes", canRemove: false }] },
  ]) assert.throws(() => parseSkillMarket(bad), /skill market response is invalid/);

  const many = { skills: Array.from({ length: 201 }, () => marketPayload.skills[0]) };
  assert.throws(() => parseSkillMarket(many), /skill market response is invalid/);
});

test("readSkillMarket reads the reviewed catalog and maps transport failures safely", async () => {
  const snap = await readSkillMarket(signal, async (input, init) => {
    assert.equal(input, "/api/v1/skill-market");
    assert.equal(init?.method, "GET");
    assert.equal(init?.cache, "no-store");
    return Response.json(marketPayload);
  });
  assert.equal(snap.skills.length, 2);

  const html: typeof fetch = async () => new Response("<html>signin</html>", { headers: { "Content-Type": "text/html" } });
  await assert.rejects(readSkillMarket(signal, html), (error: unknown) =>
    error instanceof MarketApiError && error.status === 502 && /API is unavailable/.test(error.message));

  for (const status of [401, 403, 429, 400, 502]) {
    const failing: typeof fetch = async () => Response.json({ error: "raw upstream secret trace" }, { status });
    await assert.rejects(readSkillMarket(signal, failing), (error: unknown) =>
      error instanceof MarketApiError && error.status === status && !error.message.includes("raw upstream secret trace"));
  }
});

test("createSkillMarketController reports ready state, forbidden flag, and stops after dispose", async () => {
  const states: SkillMarketState[] = [];
  const ctrl = createSkillMarketController((next) => states.push(next), jsonFetch(marketPayload));
  await ctrl.refresh();
  const ready = states.at(-1);
  assert.equal(ready?.kind, "ready");
  if (ready?.kind === "ready") assert.equal(ready.market.skills.length, 2);
  ctrl.dispose();
  const before = states.length;
  await ctrl.refresh();
  assert.equal(states.length, before, "a disposed controller must not publish state");

  const forbiddenStates: SkillMarketState[] = [];
  const forbidden = createSkillMarketController(
    (next) => forbiddenStates.push(next),
    async () => Response.json({ error: "owner_required" }, { status: 403 }),
  );
  await forbidden.refresh();
  const last = forbiddenStates.at(-1);
  assert.equal(last?.kind, "error");
  assert.equal(last?.kind === "error" && last.forbidden, true);
  forbidden.dispose();
});

test("matchesMarketRow searches title, source, state, and security", () => {
  const [ponytail, rtk] = parseSkillMarket(marketPayload).skills;
  assert.ok(ponytail && rtk);
  assert.ok(matchesMarketRow(ponytail, ""));
  assert.ok(matchesMarketRow(ponytail, "dietrichgebert"));
  assert.ok(matchesMarketRow(rtk, "installed"));
  assert.ok(matchesMarketRow(rtk, "mso-safe-wrapper"));
  assert.equal(matchesMarketRow(ponytail, "zzz-nope"), false);
});

test("category pill list keeps stable labels so the toolbar cannot drift from filters", () => {
  assert.deepEqual(CATALOG_CATEGORIES.map((entry) => entry.id),
    ["all", "managed", "connected", "ai-agents", "automation", "productivity"]);
  assert.deepEqual(CATALOG_CATEGORIES.map((entry) => entry.label),
    ["All", "Managed Apps", "Connected Apps", "AI & Agents", "Automation", "Productivity"]);
});
