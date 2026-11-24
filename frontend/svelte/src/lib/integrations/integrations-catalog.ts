import { canonicalProviderId, type IntegrationConnectionSummary } from "./integrations-api.ts";
import type { IntegrationCatalogProvider } from "./integrations-workspace-api.ts";

export type IntegrationCategoryId = "all" | "cloud" | "messaging" | "code" | "payments" | "ai" | "other";

export type IntegrationCategory = { id: IntegrationCategoryId; label: string };

export const INTEGRATION_CATEGORIES: IntegrationCategory[] = [
  { id: "all", label: "All providers" },
  { id: "cloud", label: "Cloud and host" },
  { id: "messaging", label: "Messaging" },
  { id: "code", label: "Code and accounts" },
  { id: "payments", label: "Payments and mail" },
  { id: "ai", label: "AI and Google" },
  { id: "other", label: "Local only" },
];

const CATEGORY_BY_PROVIDER: Record<string, IntegrationCategoryId> = {
  dokploy: "cloud", cloudflare: "cloud", vercel: "cloud", convex: "cloud", supabase: "cloud", mcp: "cloud",
  telegram: "messaging", discord: "messaging",
  github: "code", linear: "code", clerk: "code", openai_app: "code",
  stripe: "payments", doku: "payments", hostinger: "payments", resend: "payments",
  composio: "ai", "openai-app": "ai", "google-oauth-app": "ai",
  "google-search-console": "ai", "google-analytics": "ai",
  "mso-password": "other",
};

export function categoryOf(providerId: string): IntegrationCategoryId {
  return CATEGORY_BY_PROVIDER[canonicalProviderId(providerId)] ?? "other";
}

export type IntegrationProviderCard = {
  id: string; title: string; description: string; category: IntegrationCategoryId;
  connected: number; total: number; healthy: boolean; methods: number;
  sources: string[]; missing: string[];
};

const HEALTHY_STATES = new Set(["verified", "ACTIVE"]);

export function buildProviderCards(
  providers: IntegrationCatalogProvider[], connections: IntegrationConnectionSummary[],
): IntegrationProviderCard[] {
  return providers.map((provider) => {
    const rows = connections.filter((row) => canonicalProviderId(row.provider) === provider.id);
    const healthy = rows.length > 0 && rows.every((row) => HEALTHY_STATES.has(row.state));
    return {
      id: provider.id,
      title: provider.title,
      description: provider.description,
      category: categoryOf(provider.id),
      connected: rows.length,
      total: rows.length,
      healthy,
      methods: provider.sources.reduce((count, source) => count + source.methods.length, 0),
      sources: provider.sources.map((source) => source.label),
      missing: [...new Set(rows.flatMap((row) => row.missing))].slice(0, 6),
    };
  }).sort((a, b) => Number(b.connected > 0) - Number(a.connected > 0) || a.title.localeCompare(b.title));
}

export function filterProviderCards(
  cards: IntegrationProviderCard[], category: IntegrationCategoryId, query: string,
): IntegrationProviderCard[] {
  const q = query.trim().toLowerCase();
  return cards.filter((card) => {
    if (category !== "all" && card.category !== category) return false;
    if (!q) return true;
    const haystack = `${card.id} ${card.title} ${card.description} ${card.connected ? "connected" : "disconnected"} ${card.sources.join(" ")} ${card.missing.join(" ")}`;
    return haystack.toLowerCase().includes(q);
  });
}

export function connectionsFor(providerId: string, connections: IntegrationConnectionSummary[]): IntegrationConnectionSummary[] {
  const id = canonicalProviderId(providerId);
  return connections.filter((row) => canonicalProviderId(row.provider) === id);
}

export function providerTone(card: IntegrationProviderCard): "ok" | "warn" | "neutral" {
  if (card.connected === 0) return "neutral";
  return card.healthy ? "ok" : "warn";
}
