export type ProviderSummary = {
  id: string;
  name: string;
  catalogId: string;
  modelCount: number;
  freeModelCount: number;
  freeAgentModelCount: number;
  recommendedFreeModel: string | null;
};

// Offline fallback only. The live /api/models/providers catalog is the primary source.
export const FALLBACK_PROVIDER_OPTIONS: ProviderSummary[] = [
  { id: "opencode", name: "OpenCode Zen", catalogId: "opencode", modelCount: 0, freeModelCount: 0, freeAgentModelCount: 0, recommendedFreeModel: null },
  { id: "anthropic", name: "Anthropic", catalogId: "anthropic", modelCount: 0, freeModelCount: 0, freeAgentModelCount: 0, recommendedFreeModel: null },
  { id: "openai", name: "OpenAI Platform", catalogId: "openai", modelCount: 0, freeModelCount: 0, freeAgentModelCount: 0, recommendedFreeModel: null },
  { id: "openrouter", name: "OpenRouter", catalogId: "openrouter", modelCount: 0, freeModelCount: 0, freeAgentModelCount: 0, recommendedFreeModel: null },
  { id: "google", name: "Google Gemini", catalogId: "google", modelCount: 0, freeModelCount: 0, freeAgentModelCount: 0, recommendedFreeModel: null },
  { id: "groq", name: "Groq", catalogId: "groq", modelCount: 0, freeModelCount: 0, freeAgentModelCount: 0, recommendedFreeModel: null },
  { id: "xai", name: "xAI", catalogId: "xai", modelCount: 0, freeModelCount: 0, freeAgentModelCount: 0, recommendedFreeModel: null },
  { id: "deepseek", name: "DeepSeek", catalogId: "deepseek", modelCount: 0, freeModelCount: 0, freeAgentModelCount: 0, recommendedFreeModel: null },
  { id: "mistral", name: "Mistral", catalogId: "mistral", modelCount: 0, freeModelCount: 0, freeAgentModelCount: 0, recommendedFreeModel: null },
];

export function groupProviderOptions(rows: ProviderSummary[]) {
  return {
    free: rows.filter((row) => row.freeAgentModelCount > 0),
    other: rows.filter((row) => row.freeAgentModelCount === 0),
  };
}

export function suggestedProviderModel(rows: ProviderSummary[], provider: string, fallback = ""): string {
  return rows.find((row) => row.id === provider)?.recommendedFreeModel || fallback;
}
