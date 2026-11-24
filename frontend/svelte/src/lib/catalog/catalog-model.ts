// Pure storefront model for the App Store and Extensions catalog.
// No DOM, no fetch: cards, categories, search, sort and URL/integrity safety
// live here so the Svelte views stay declarative and the rules stay testable.
import type { AppCatalogSnapshot, ModularFeatureSummary } from "./catalog-api.ts";

export type CatalogCategory = "ai-agents" | "automation" | "productivity";
/** Pill ids, in render order. `all` is not a category a card can own. */
export type CatalogCategoryId = "all" | "managed" | "connected" | CatalogCategory;
export type CatalogSortId = "curated" | "name" | "kind";
export type Tone = "ok" | "warn" | "danger" | "neutral";

export const CATALOG_CATEGORIES: ReadonlyArray<{ id: CatalogCategoryId; label: string }> = [
  { id: "all", label: "All" },
  { id: "managed", label: "Managed Apps" },
  { id: "connected", label: "Connected Apps" },
  { id: "ai-agents", label: "AI & Agents" },
  { id: "automation", label: "Automation" },
  { id: "productivity", label: "Productivity" },
];

export const CATALOG_SORTS: ReadonlyArray<{ id: CatalogSortId; label: string }> = [
  { id: "curated", label: "Featured first" },
  { id: "name", label: "Name A to Z" },
  { id: "kind", label: "Managed before connected" },
];

/** Curated copy for the managed adapters MSO ships. Unknown ids fall back to the raw id. */
const MANAGED_META: Record<string, { title: string; summary: string; category: CatalogCategory }> = {
  hermes: { title: "Hermes Agent", summary: "Agent runtime with dashboard, memory and MCP tools.", category: "ai-agents" },
  openclaw: { title: "OpenClaw", summary: "Agent control surface for long-running coding work.", category: "ai-agents" },
  "9router": { title: "9Router", summary: "One AI gateway routing agents across many providers.", category: "ai-agents" },
  orca: { title: "Orca", summary: "Web workspace that hosts agent worktrees and terminals.", category: "ai-agents" },
  t3: { title: "T3 Code", summary: "Multi-agent coding server with thread orchestration.", category: "ai-agents" },
  n8n: { title: "n8n", summary: "Self-hosted workflow automation with visual graphs.", category: "automation" },
};

const AUTOMATION_HINTS = /automation|workflow|n8n|scheduler|pipeline/;
const AGENT_HINTS = /agent|assistant|copilot|llm|router|bot/;

export type CatalogCard = {
  key: string;
  kind: "managed" | "connected";
  id: string;
  title: string;
  summary: string;
  category: CatalogCategory;
  kindLabel: string;
  /** Publisher or version line, when the upstream entry carries one. */
  meta: string;
  launchUrl: string | null;
  /** True for the single hero entry the storefront spotlights. */
  spotlight: boolean;
};

/** Only absolute http(s) URLs without embedded credentials may leave the app. */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed: URL;
  try { parsed = new URL(raw.trim()); } catch { return null; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;
  return parsed.href;
}

export function classifyConnected(id: string, text: string): CatalogCategory {
  const haystack = `${id} ${text}`.toLowerCase();
  if (AUTOMATION_HINTS.test(haystack)) return "automation";
  if (AGENT_HINTS.test(haystack)) return "ai-agents";
  return "productivity";
}

export function buildCatalogCards(snapshot: AppCatalogSnapshot): CatalogCard[] {
  const cards = snapshot.entries.map((entry): CatalogCard => {
    if (entry.kind === "managed") {
      const meta = MANAGED_META[entry.id];
      return {
        key: `managed:${entry.id}`, kind: "managed", id: entry.id,
        title: meta?.title ?? entry.id,
        summary: meta?.summary ?? "Managed container application template provisioned by this host.",
        category: meta?.category ?? "productivity",
        kindLabel: "Managed App", meta: "host adapter", launchUrl: null, spotlight: false,
      };
    }
    const manifest = entry.manifest;
    const title = manifest.name ?? manifest.id;
    const summary = manifest.description ?? "Connected application published by an external provider.";
    const launchUrl = safeExternalUrl(manifest.launchUrl);
    return {
      key: `connected:${manifest.id}`, kind: "connected", id: manifest.id, title, summary,
      category: classifyConnected(manifest.id, `${title} ${summary}`),
      kindLabel: "Connected App",
      meta: launchUrl ? new URL(launchUrl).host : "external provider",
      launchUrl, spotlight: false,
    };
  });
  const hero = cards.find((card) => card.kind === "managed") ?? cards[0];
  return hero ? cards.map((card) => (card.key === hero.key ? { ...card, spotlight: true } : card)) : cards;
}

export function matchesCard(card: CatalogCard, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${card.title} ${card.id} ${card.summary} ${card.category} ${card.kind} ${card.meta}`
    .toLowerCase().includes(q);
}

export function filterCatalogCards(
  cards: readonly CatalogCard[], query: string, category: CatalogCategoryId,
): CatalogCard[] {
  return cards.filter((card) =>
    (category === "all" || card.kind === category || card.category === category)
    && matchesCard(card, query));
}

export function sortCatalogCards(cards: readonly CatalogCard[], sort: CatalogSortId): CatalogCard[] {
  const copy = [...cards];
  if (sort === "name") return copy.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "kind") {
    return copy.sort((a, b) =>
      a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === "managed" ? -1 : 1);
  }
  return copy;
}

export function catalogStatusTone(status: string): Tone {
  if (status === "remote") return "ok";
  if (status === "stale") return "warn";
  return "danger";
}

export function trustTone(trust: string): Tone {
  const t = trust.trim().toLowerCase();
  if (t === "official" || t === "verified" || t === "trusted" || t === "builtin") return "ok";
  if (t === "local" || t === "community" || t === "review") return "warn";
  if (t === "untrusted" || t === "blocked") return "danger";
  return "neutral";
}

export function marketStateTone(state: string): Tone {
  if (state === "installed") return "ok";
  if (state === "update-available" || state === "not-installed") return "neutral";
  if (state === "modified") return "warn";
  if (state === "conflict") return "danger";
  return "neutral";
}

/** `sha256-<64 hex>` to a short badge; null when the package carries no digest. */
export function formatIntegrity(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const match = /^sha256-([a-f0-9]{64})$/.exec(raw.trim());
  return match ? `sha256:${match[1].slice(0, 12)}` : null;
}

export function integrityTone(raw: string | null | undefined): Tone {
  return formatIntegrity(raw) ? "ok" : "warn";
}

export function featureHeading(feature: ModularFeatureSummary): string {
  return feature.title ?? feature.name ?? feature.id;
}
