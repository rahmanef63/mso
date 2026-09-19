import { DEFAULT_MODELS } from "@/lib/models/defaults";

export type QuickConnectedProvider = {
  id: string;
  kind?: "builtin" | "custom" | "oauth";
  hasKey?: boolean;
};

export type QuickCatalogModel = {
  id: string;
  name?: string;
  tools?: boolean;
  reasoning?: boolean;
  vision?: boolean;
};

const LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI Platform",
  "openai-codex": "OpenAI Codex",
  google: "Google Gemini",
  openrouter: "OpenRouter",
  groq: "Groq",
  xai: "xAI",
  deepseek: "DeepSeek",
  mistral: "Mistral",
  opencode: "OpenCode Zen",
};

export function quickProviderLabel(id: string): string {
  return LABELS[id] ?? id;
}

export function quickProviderIds(currentProvider: string, connected: QuickConnectedProvider[]): string[] {
  const ids: string[] = [];
  const add = (id: string) => {
    const normalized = id.trim();
    if (normalized && !ids.includes(normalized)) ids.push(normalized);
  };
  add(currentProvider);
  for (const provider of connected) {
    if (provider.hasKey || provider.kind === "oauth") add(provider.id);
  }
  return ids;
}

export function quickModelForProvider(
  provider: string,
  rows: QuickCatalogModel[],
  activeProvider: string,
  activeModel: string,
): string {
  if (provider === activeProvider && activeModel && rows.some((row) => row.id === activeModel)) return activeModel;
  const preferred = DEFAULT_MODELS[provider] ?? "";
  if (preferred && rows.some((row) => row.id === preferred)) return preferred;
  return rows[0]?.id ?? (provider === activeProvider ? activeModel : preferred);
}
