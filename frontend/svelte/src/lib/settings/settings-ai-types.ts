import type { ShellBridge } from "../shell-bridge.ts";

export type TokenSaverMode = "off" | "caveman" | "ponytail";

export type ConnectedProvider = {
  id: string;
  kind: "builtin" | "custom" | "oauth";
  hasKey: boolean;
  masked: string;
  baseUrl?: string;
  protocol?: "openai" | "anthropic";
  models?: string[];
};

export type AiConfig = {
  provider: string;
  model: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  providers: ConnectedProvider[];
  tokenSaver: TokenSaverMode;
};

export type ModelProviderSummary = {
  id: string;
  name: string;
  catalogId: string;
  modelCount: number;
  freeModelCount: number;
  freeAgentModelCount: number;
  recommendedFreeModel: string | null;
};

export type CatalogModel = {
  ref: string;
  provider: string;
  id: string;
  name: string;
  context?: number;
  inputCost?: number;
  outputCost?: number;
  tools?: boolean;
  free: boolean;
  agentReady: boolean;
  reasoning?: boolean;
  vision?: boolean;
};

export type DiscoverResult = {
  ok: boolean;
  count: number;
  models: string[];
  error?: string;
};

export type ModelTestResult = {
  ok: boolean;
  provider?: string;
  model?: string;
  error?: string;
};

export const FALLBACK_PROVIDERS: readonly ModelProviderSummary[] = [
  { id: "anthropic", name: "Anthropic", catalogId: "anthropic", modelCount: 0, freeModelCount: 0, freeAgentModelCount: 0, recommendedFreeModel: null },
  { id: "openai", name: "OpenAI", catalogId: "openai", modelCount: 0, freeModelCount: 0, freeAgentModelCount: 0, recommendedFreeModel: null },
  { id: "openrouter", name: "OpenRouter", catalogId: "openrouter", modelCount: 0, freeModelCount: 0, freeAgentModelCount: 0, recommendedFreeModel: null },
  { id: "google", name: "Google Gemini", catalogId: "google", modelCount: 0, freeModelCount: 0, freeAgentModelCount: 0, recommendedFreeModel: null },
  { id: "groq", name: "Groq", catalogId: "groq", modelCount: 0, freeModelCount: 0, freeAgentModelCount: 0, recommendedFreeModel: null },
  { id: "xai", name: "xAI", catalogId: "xai", modelCount: 0, freeModelCount: 0, freeAgentModelCount: 0, recommendedFreeModel: null },
];

const KEY_HINTS: Readonly<Record<string, string>> = {
  anthropic: "sk-ant-...",
  openai: "sk-...",
  openrouter: "sk-or-...",
  google: "AIza...",
  groq: "gsk_...",
  xai: "xai-...",
};

export function providerKeyHint(provider: string): string {
  return KEY_HINTS[provider] ?? "Paste API key";
}

export function parseTokenSaver(raw: unknown): TokenSaverMode {
  return raw === "caveman" || raw === "ponytail" ? raw : "off";
}

export type SaveAiConfigPayload = {
  provider?: string;
  model?: string;
  apiKey?: string;
  tokenSaver?: TokenSaverMode;
  select?: boolean;
  customProvider?: {
    name: string;
    baseURL: string;
    apiKey?: string;
    protocol: "openai" | "anthropic";
    models?: string[];
  };
};
