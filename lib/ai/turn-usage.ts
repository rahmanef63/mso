import type { ProviderUsage } from "@/lib/ai/stream";
import { addProviderUsage } from "@/lib/ai/provider-usage.mjs";

export function formatTurnUsage(usage?: ProviderUsage | null, label = "this turn"): string {
  if (!usage) return "";
  const input = (usage.inputTokens ?? 0).toLocaleString();
  const output = (usage.outputTokens ?? 0).toLocaleString();
  const parts = [`${label}: ${input} in`, `${output} out`];
  if (usage.cacheReadTokens != null) {
    parts.push(`${usage.cacheReadTokens.toLocaleString()} cached`);
  }
  return parts.join(" / ");
}

export function formatThreadUsage(total?: ProviderUsage | null): string {
  return formatTurnUsage(total, "thread total");
}

export function formatUsageSummary(turn?: ProviderUsage | null, total?: ProviderUsage | null): string {
  const turnStr = formatTurnUsage(turn);
  const totalStr = formatThreadUsage(total);
  if (turnStr && totalStr) return `${turnStr} · ${totalStr}`;
  return turnStr || totalStr;
}

export function addUsage(total?: ProviderUsage | null, next?: ProviderUsage | null): ProviderUsage {
  return addProviderUsage(total, next) as ProviderUsage;
}

export type { ProviderUsage };
