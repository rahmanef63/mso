import { ApiError } from "../host-api.ts";
import { detectShellBridge } from "../shell-bridge.ts";
import type { ShellBridge } from "../shell-bridge.ts";
import { isRecord, requestJson } from "./settings-request.ts";
import { parseTokenSaver } from "./settings-ai-types.ts";
import type {
  AiConfig, CatalogModel, ConnectedProvider, DiscoverResult, ModelTestResult,
  ModelProviderSummary, SaveAiConfigPayload, TokenSaverMode,
} from "./settings-ai-types.ts";
export * from "./settings-ai-types.ts";

// ---------------------------------------------------------------------------
// AI & Models (BYOK)
// ---------------------------------------------------------------------------

export async function readAiConfig(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<AiConfig> {
  const raw = await requestJson("/api/config", { label: "AI configuration", signal, fetcher, bridge });
  if (!isRecord(raw) || typeof raw.provider !== "string" || typeof raw.model !== "string") {
    throw new ApiError("The AI configuration response is invalid.", 502);
  }
  const providers: ConnectedProvider[] = Array.isArray(raw.providers)
    ? raw.providers.flatMap((item): ConnectedProvider[] => {
        if (!isRecord(item) || typeof item.id !== "string") return [];
        const kind = item.kind === "custom" || item.kind === "oauth" ? item.kind : "builtin";
        const protocol = item.protocol === "anthropic" ? "anthropic" : item.protocol === "openai" ? "openai" : undefined;
        return [{
          id: item.id,
          kind,
          hasKey: Boolean(item.hasKey),
          masked: typeof item.masked === "string" ? item.masked : "",
          ...(typeof item.baseUrl === "string" ? { baseUrl: item.baseUrl } : {}),
          ...(protocol ? { protocol } : {}),
          ...(Array.isArray(item.models) ? { models: item.models.filter((m): m is string => typeof m === "string") } : {}),
        }];
      })
    : [];
  return {
    provider: raw.provider,
    model: raw.model,
    hasApiKey: Boolean(raw.hasApiKey),
    apiKeyMasked: typeof raw.apiKeyMasked === "string" ? raw.apiKeyMasked : "",
    providers,
    tokenSaver: parseTokenSaver(raw.tokenSaver),
  };
}

export async function saveAiConfig(
  payload: SaveAiConfigPayload,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<{ ok: boolean; slug?: string }> {
  const raw = await requestJson("/api/config", {
    method: "POST",
    body: payload as Record<string, unknown>,
    label: "AI configuration",
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || raw.ok !== true) {
    throw new ApiError("Could not save AI configuration.", 502);
  }
  return { ok: true, ...(typeof raw.slug === "string" ? { slug: raw.slug } : {}) };
}

export async function deleteAiProvider(
  provider: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<void> {
  const raw = await requestJson(`/api/config?provider=${encodeURIComponent(provider)}`, {
    method: "DELETE",
    label: "AI provider removal",
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || raw.ok !== true) {
    throw new ApiError("Could not disconnect AI provider.", 502);
  }
}

export async function readModelProviders(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
  freeOnly = false,
): Promise<ModelProviderSummary[]> {
  const path = freeOnly ? "/api/models/providers?free=1" : "/api/models/providers";
  const raw = await requestJson(path, { label: "model providers", signal, fetcher, bridge });
  if (!isRecord(raw) || !Array.isArray(raw.providers)) {
    throw new ApiError("The model providers response is invalid.", 502);
  }
  return raw.providers.flatMap((row): ModelProviderSummary[] => {
    if (!isRecord(row) || typeof row.id !== "string") return [];
    return [{
      id: row.id,
      name: typeof row.name === "string" && row.name.trim() ? row.name : row.id,
      catalogId: typeof row.catalogId === "string" ? row.catalogId : row.id,
      modelCount: typeof row.modelCount === "number" ? row.modelCount : 0,
      freeModelCount: typeof row.freeModelCount === "number" ? row.freeModelCount : 0,
      freeAgentModelCount: typeof row.freeAgentModelCount === "number" ? row.freeAgentModelCount : 0,
      recommendedFreeModel: typeof row.recommendedFreeModel === "string" ? row.recommendedFreeModel : null,
    }];
  });
}

export async function readModelsCatalog(
  provider: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
  freeOnly = false,
): Promise<CatalogModel[]> {
  const qs = new URLSearchParams();
  if (provider.trim()) qs.set("provider", provider.trim());
  if (freeOnly) qs.set("free", "1");
  const suffix = qs.toString();
  const raw = await requestJson(suffix ? `/api/models?${suffix}` : "/api/models", {
    label: "model catalog",
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || !Array.isArray(raw.models)) {
    throw new ApiError("The model catalog response is invalid.", 502);
  }
  const rows = raw.models.flatMap((row): CatalogModel[] => {
    if (!isRecord(row) || typeof row.id !== "string") return [];
    const prov = typeof row.provider === "string" ? row.provider : provider;
    return [{
      ref: typeof row.ref === "string" ? row.ref : `${prov}/${row.id}`,
      provider: prov,
      id: row.id,
      name: typeof row.name === "string" && row.name.trim() ? row.name : row.id,
      ...(typeof row.context === "number" ? { context: row.context } : {}),
      ...(typeof row.inputCost === "number" ? { inputCost: row.inputCost } : {}),
      ...(typeof row.outputCost === "number" ? { outputCost: row.outputCost } : {}),
      tools: Boolean(row.tools),
      free: Boolean(row.free),
      agentReady: Boolean(row.agentReady),
      reasoning: Boolean(row.reasoning),
      vision: Boolean(row.vision),
    }];
  });
  return rows.sort((a, b) =>
    Number(b.free && b.agentReady) - Number(a.free && a.agentReady)
      || Number(b.free) - Number(a.free)
      || a.id.localeCompare(b.id),
  );
}

export async function discoverEndpointModels(
  payload: { provider?: string; baseURL?: string; apiKey?: string; protocol?: "openai" | "anthropic" },
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<DiscoverResult> {
  const raw = await requestJson("/api/models/discover", {
    method: "POST",
    body: payload as Record<string, unknown>,
    label: "model discovery",
    timeoutMs: 25_000,
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || typeof raw.ok !== "boolean") {
    throw new ApiError("The model discovery response is invalid.", 502);
  }
  const models = Array.isArray(raw.models)
    ? raw.models.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
    : [];
  return {
    ok: raw.ok,
    count: typeof raw.count === "number" ? raw.count : models.length,
    models,
    ...(typeof raw.error === "string" ? { error: raw.error } : {}),
  };
}

export async function testAiConnection(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<ModelTestResult> {
  const raw = await requestJson("/api/models/test", {
    method: "POST",
    label: "AI connection test",
    timeoutMs: 35_000,
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || typeof raw.ok !== "boolean") {
    throw new ApiError("The AI connection test response is invalid.", 502);
  }
  return {
    ok: raw.ok,
    ...(typeof raw.provider === "string" ? { provider: raw.provider } : {}),
    ...(typeof raw.model === "string" ? { model: raw.model } : {}),
    ...(typeof raw.error === "string" ? { error: raw.error } : {}),
  };
}
