import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export { ApiError };
export type { ShellBridge };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const API_UNAVAILABLE = "MSO API is unavailable. Configure the local backend before retrying.";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const fixed = unit === 0 ? Math.round(value).toString() : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${fixed} ${units[unit]}`;
}

export function formatTimestamp(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "Never";
  if (value === 0) return "Never";
  const ms = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return String(value);
  return new Date(ms).toLocaleString();
}

function statusMessage(status: number, label: string): string {
  if (status === 401) return "Your session is unavailable or this device no longer has access.";
  if (status === 403) return `Owner role is required to manage ${label}.`;
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  return `${label} request failed (${status}).`;
}

async function requestJson(
  path: string,
  options: {
    method?: "GET" | "POST" | "DELETE";
    body?: Record<string, unknown>;
    label: string;
    timeoutMs?: number;
    signal: AbortSignal;
    fetcher: typeof fetch;
    bridge: ShellBridge;
  },
): Promise<unknown> {
  const method = options.method ?? "GET";
  const res = await options.fetcher(resolveApiUrl(path, options.bridge), {
    method,
    credentials: options.bridge.apiBaseOrigin ? "include" : "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 15_000)]),
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const isJson = res.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!res.ok) throw new ApiError(statusMessage(res.status, options.label), res.status);
    throw new ApiError(API_UNAVAILABLE, 502);
  }
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new ApiError(`The ${options.label} response is invalid.`, 502);
  }
  if (!res.ok) {
    const serverMsg = isRecord(parsed) && typeof parsed.error === "string" && parsed.error.trim()
      ? parsed.error.trim()
      : null;
    if (res.status === 401 || res.status === 403) {
      throw new ApiError(statusMessage(res.status, options.label), res.status);
    }
    throw new ApiError(serverMsg ?? statusMessage(res.status, options.label), res.status);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// AI & Models (BYOK)
// ---------------------------------------------------------------------------

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

function parseTokenSaver(raw: unknown): TokenSaverMode {
  return raw === "caveman" || raw === "ponytail" ? raw : "off";
}

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

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

export type McpScope = "read" | "write" | "exec";

export type McpTokenRow = {
  id: string;
  label: string;
  clientId: string;
  scope: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt?: number;
  status: "active" | "revoked" | "expired";
};

export type McpStatusPayload = {
  enabled: boolean;
  maxScope: McpScope;
  origin: string;
  toolset: { count: number; version: string; signature: string };
  tokens: McpTokenRow[];
  targetIdentity?: { hostname?: string; platform?: string; release?: string; user?: string };
};

export type McpActivityEntry = {
  id: string;
  ts: string;
  actor?: string;
  tool: string;
  state: string;
  scope?: string;
  target?: string;
  durationMs?: number;
  detail?: string;
};

export type McpClientGuideId = "claude-code" | "cursor" | "chatgpt" | "codex" | "vscode" | "antigravity";

export type McpClientGuide = {
  id: McpClientGuideId;
  label: string;
  summary: string;
  steps: readonly string[];
  snippetLabel: string;
  snippet: string;
};

export function normalizeMcpOrigin(rawOrigin: string): string {
  const trimmed = rawOrigin.trim();
  if (!trimmed) return "https://your-mso-host.example.com";
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

export function buildMcpClientGuides(rawOrigin: string, patToken?: string): McpClientGuide[] {
  const origin = normalizeMcpOrigin(rawOrigin);
  const mcpUrl = `${origin}/mcp`;
  const authHeader = `Bearer ${patToken?.trim() || "<YOUR_PAT_TOKEN>"}`;
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      summary: "Remote Streamable HTTP with browser OAuth or bearer PAT.",
      steps: [
        "Run the CLI add command below in your terminal.",
        "Start Claude Code and approve the OAuth prompt or pass a Personal Access Token header.",
      ],
      snippetLabel: "Claude Code CLI",
      snippet: `claude mcp add --transport http mso ${mcpUrl}`,
    },
    {
      id: "cursor",
      label: "Cursor",
      summary: "Add MSO as a remote MCP server inside .cursor/mcp.json.",
      steps: [
        "Open Cursor Settings -> Tools & MCP -> Add Custom MCP.",
        "Paste the JSON block into ~/.cursor/mcp.json and reload MCP tools.",
      ],
      snippetLabel: "mcp.json",
      snippet: JSON.stringify(
        { mcpServers: { mso: { url: mcpUrl, headers: { Authorization: authHeader } } } },
        null,
        2,
      ),
    },
    {
      id: "chatgpt",
      label: "ChatGPT",
      summary: "Connect via ChatGPT Apps / Plugins with OAuth discovery.",
      steps: [
        "Open ChatGPT Settings -> Apps / Connectors -> Create new MCP app.",
        `Enter ${mcpUrl} as the MCP Server URL and select OAuth authentication.`,
        "Complete the MSO owner approval screen to grant scoped access.",
      ],
      snippetLabel: "MCP Endpoint URL",
      snippet: mcpUrl,
    },
    {
      id: "codex",
      label: "Codex",
      summary: "Register MSO in ~/.codex/config.toml.",
      steps: [
        "Add the TOML block below to ~/.codex/config.toml.",
        "Restart Codex to load the MSO toolset.",
      ],
      snippetLabel: "config.toml",
      snippet: `[mcp_servers.mso]\nurl = "${mcpUrl}"`,
    },
    {
      id: "vscode",
      label: "VS Code",
      summary: "Configure Streamable HTTP MCP in .vscode/mcp.json.",
      steps: [
        "Run Command Palette -> MCP: Open User Configuration.",
        "Paste the server entry below and authenticate when prompted.",
      ],
      snippetLabel: "mcp.json",
      snippet: JSON.stringify(
        { servers: { mso: { type: "http", url: mcpUrl } } },
        null,
        2,
      ),
    },
    {
      id: "antigravity",
      label: "Antigravity",
      summary: "Attach MSO with a scoped Personal Access Token header.",
      steps: [
        "Generate a Personal Access Token below with the lowest scope needed.",
        "Add the JSON block to your Antigravity MCP configuration.",
      ],
      snippetLabel: "MCP Config",
      snippet: JSON.stringify(
        { mso: { url: mcpUrl, headers: { Authorization: authHeader } } },
        null,
        2,
      ),
    },
  ];
}

export async function readMcpStatus(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<McpStatusPayload> {
  const raw = await requestJson("/api/mcp/tokens", { label: "MCP status", signal, fetcher, bridge });
  if (!isRecord(raw) || typeof raw.enabled !== "boolean") {
    throw new ApiError("The MCP status response is invalid.", 502);
  }
  const maxScope: McpScope = raw.maxScope === "exec" || raw.maxScope === "write" ? raw.maxScope : "read";
  const tsRaw = isRecord(raw.toolset) ? raw.toolset : {};
  const tokens: McpTokenRow[] = Array.isArray(raw.tokens)
    ? raw.tokens.flatMap((row): McpTokenRow[] => {
        if (!isRecord(row) || typeof row.id !== "string") return [];
        const status = row.status === "revoked" || row.status === "expired" ? row.status : "active";
        return [{
          id: row.id,
          label: typeof row.label === "string" ? row.label : row.id,
          clientId: typeof row.clientId === "string" ? row.clientId : "pat",
          scope: typeof row.scope === "string" ? row.scope : "read",
          createdAt: typeof row.createdAt === "number" ? row.createdAt : 0,
          expiresAt: typeof row.expiresAt === "number" ? row.expiresAt : 0,
          ...(typeof row.lastUsedAt === "number" ? { lastUsedAt: row.lastUsedAt } : {}),
          status,
        }];
      })
    : [];
  const targetRaw = isRecord(raw.targetIdentity) ? raw.targetIdentity : undefined;
  return {
    enabled: raw.enabled,
    maxScope,
    origin: typeof raw.origin === "string" ? raw.origin : "",
    toolset: {
      count: typeof tsRaw.count === "number" ? tsRaw.count : 0,
      version: typeof tsRaw.version === "string" ? tsRaw.version : "",
      signature: typeof tsRaw.signature === "string" ? tsRaw.signature : "",
    },
    tokens,
    ...(targetRaw
      ? {
          targetIdentity: {
            ...(typeof targetRaw.hostname === "string" ? { hostname: targetRaw.hostname } : {}),
            ...(typeof targetRaw.platform === "string" ? { platform: targetRaw.platform } : {}),
            ...(typeof targetRaw.release === "string" ? { release: targetRaw.release } : {}),
            ...(typeof targetRaw.user === "string" ? { user: targetRaw.user } : {}),
          },
        }
      : {}),
  };
}

export async function mintMcpToken(
  input: { label: string; scope: McpScope; ttlDays: 0 | 7 | 30 | 90 },
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<{ token: string; tokenView?: McpTokenRow }> {
  const raw = await requestJson("/api/mcp/tokens", {
    method: "POST",
    body: input,
    label: "MCP token creation",
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || typeof raw.token !== "string" || !raw.token) {
    throw new ApiError("The MCP token creation response is invalid.", 502);
  }
  return { token: raw.token };
}

export async function revokeMcpToken(
  id: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<number> {
  const raw = await requestJson(`/api/mcp/tokens?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    label: "MCP token revocation",
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || typeof raw.revoked !== "number") {
    throw new ApiError("The MCP token revocation response is invalid.", 502);
  }
  return raw.revoked;
}

export async function readMcpActivity(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
  limit = 40,
): Promise<McpActivityEntry[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit) || 40, 1), 200);
  const raw = await requestJson(`/api/mcp/activity?limit=${safeLimit}`, {
    label: "MCP activity",
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || !Array.isArray(raw.entries)) {
    throw new ApiError("The MCP activity response is invalid.", 502);
  }
  return raw.entries.flatMap((row): McpActivityEntry[] => {
    if (!isRecord(row) || typeof row.id !== "string" || typeof row.tool !== "string") return [];
    return [{
      id: row.id,
      ts: typeof row.ts === "string" ? row.ts : "",
      ...(typeof row.actor === "string" ? { actor: row.actor } : {}),
      tool: row.tool,
      state: typeof row.state === "string" ? row.state : "completed",
      ...(typeof row.scope === "string" ? { scope: row.scope } : {}),
      ...(typeof row.target === "string" ? { target: row.target } : {}),
      ...(typeof row.durationMs === "number" ? { durationMs: row.durationMs } : {}),
      ...(typeof row.detail === "string" ? { detail: row.detail } : {}),
    }];
  });
}

// ---------------------------------------------------------------------------
// Memory & Server Backup
// ---------------------------------------------------------------------------

export type MemoryFact = { id: string; text: string; createdAt: number };

export type MemoryBackupScan = {
  files: number;
  bytes: number;
  missing: number;
  rejected: number;
  excluded: number;
  truncated: boolean;
};

export type MemoryBackupSummary = {
  id: string;
  state: "snapshot" | "partial";
  createdAt: string;
  directory: string;
  manifestSha256: string;
  scan: MemoryBackupScan;
  compressedBytes: number;
  sourceDiscoveryTruncated: boolean;
};

export type MemoryBackupVerification = {
  id: string;
  integrity: boolean;
  restoredFiles: number;
  restoreDirectory: string;
  complete: boolean;
  sourceWritesPerformed: number;
};

export type MemoryBackupHistoryEntry =
  | {
      id: string;
      status: "readable";
      snapshot: MemoryBackupSummary;
      integrity: "not-recorded" | "verified-at-recorded-time" | "receipt-invalid";
      verifiedAt?: string;
    }
  | { id: string; status: "unreadable"; error: string };

function parseBackupScan(raw: unknown): MemoryBackupScan {
  if (!isRecord(raw)) throw new ApiError("The memory backup scan response is invalid.", 502);
  return {
    files: typeof raw.files === "number" ? raw.files : 0,
    bytes: typeof raw.bytes === "number" ? raw.bytes : 0,
    missing: typeof raw.missing === "number" ? raw.missing : 0,
    rejected: typeof raw.rejected === "number" ? raw.rejected : 0,
    excluded: typeof raw.excluded === "number" ? raw.excluded : 0,
    truncated: Boolean(raw.truncated),
  };
}

function parseBackupSummary(raw: unknown): MemoryBackupSummary {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.manifestSha256 !== "string") {
    throw new ApiError("The memory backup summary response is invalid.", 502);
  }
  return {
    id: raw.id,
    state: raw.state === "partial" ? "partial" : "snapshot",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    directory: typeof raw.directory === "string" ? raw.directory : "",
    manifestSha256: raw.manifestSha256,
    scan: parseBackupScan(raw.scan),
    compressedBytes: typeof raw.compressedBytes === "number" ? raw.compressedBytes : 0,
    sourceDiscoveryTruncated: Boolean(raw.sourceDiscoveryTruncated),
  };
}

export async function readMemories(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<MemoryFact[]> {
  const raw = await requestJson("/api/memory", { label: "memory facts", signal, fetcher, bridge });
  if (!isRecord(raw) || !Array.isArray(raw.memories)) {
    throw new ApiError("The memory response is invalid.", 502);
  }
  return raw.memories.flatMap((row): MemoryFact[] => {
    if (!isRecord(row) || typeof row.id !== "string" || typeof row.text !== "string") return [];
    return [{
      id: row.id,
      text: row.text,
      createdAt: typeof row.createdAt === "number" ? row.createdAt : 0,
    }];
  });
}

export async function addMemoryFact(
  text: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<MemoryFact | null> {
  const raw = await requestJson("/api/memory", {
    method: "POST",
    body: { text: text.trim() },
    label: "memory save",
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || raw.ok !== true) {
    throw new ApiError("Could not save memory fact.", 502);
  }
  if (isRecord(raw.memory) && typeof raw.memory.id === "string" && typeof raw.memory.text === "string") {
    return {
      id: raw.memory.id,
      text: raw.memory.text,
      createdAt: typeof raw.memory.createdAt === "number" ? raw.memory.createdAt : Date.now(),
    };
  }
  return null;
}

export async function deleteMemoryFact(
  id: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<void> {
  const raw = await requestJson(`/api/memory?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    label: "memory removal",
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || raw.ok !== true) {
    throw new ApiError("Could not delete memory fact.", 502);
  }
}

export async function readMemoryBackupPreview(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<MemoryBackupScan> {
  const raw = await requestJson("/api/v1/sys/memory-backup", {
    label: "memory backup preview",
    signal,
    fetcher,
    bridge,
  });
  return parseBackupScan(raw);
}

export async function readMemoryBackupHistory(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
  offset = 0,
): Promise<{ items: MemoryBackupHistoryEntry[]; nextOffset: number | null }> {
  const safeOffset = Math.max(0, Math.floor(offset));
  const raw = await requestJson(`/api/v1/sys/memory-backup?view=history&offset=${safeOffset}`, {
    label: "memory backup history",
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || !Array.isArray(raw.items)) {
    throw new ApiError("The memory backup history response is invalid.", 502);
  }
  const items: MemoryBackupHistoryEntry[] = raw.items.flatMap((row): MemoryBackupHistoryEntry[] => {
    if (!isRecord(row) || typeof row.id !== "string") return [];
    if (row.status === "readable" && isRecord(row.snapshot)) {
      const integrity =
        row.integrity === "verified-at-recorded-time" || row.integrity === "receipt-invalid"
          ? row.integrity
          : "not-recorded";
      return [{
        id: row.id,
        status: "readable",
        snapshot: parseBackupSummary(row.snapshot),
        integrity,
        ...(typeof row.verifiedAt === "string" ? { verifiedAt: row.verifiedAt } : {}),
      }];
    }
    return [{
      id: row.id,
      status: "unreadable",
      error: typeof row.error === "string" ? row.error : "snapshot-unreadable",
    }];
  });
  return {
    items,
    nextOffset: typeof raw.nextOffset === "number" ? raw.nextOffset : null,
  };
}

export async function createMemoryBackupSnapshot(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<MemoryBackupSummary> {
  const raw = await requestJson("/api/v1/sys/memory-backup", {
    method: "POST",
    body: { action: "create", confirm: true },
    label: "memory backup snapshot",
    timeoutMs: 30_000,
    signal,
    fetcher,
    bridge,
  });
  return parseBackupSummary(raw);
}

export async function verifyMemoryBackupSnapshot(
  id: string,
  manifestSha256: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<MemoryBackupVerification> {
  const raw = await requestJson("/api/v1/sys/memory-backup", {
    method: "POST",
    body: { action: "verify", confirm: true, id, manifest_sha256: manifestSha256 },
    label: "memory backup verification",
    timeoutMs: 30_000,
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.integrity !== "boolean") {
    throw new ApiError("The memory backup verification response is invalid.", 502);
  }
  return {
    id: raw.id,
    integrity: raw.integrity,
    restoredFiles: typeof raw.restoredFiles === "number" ? raw.restoredFiles : 0,
    restoreDirectory: typeof raw.restoreDirectory === "string" ? raw.restoreDirectory : "",
    complete: Boolean(raw.complete),
    sourceWritesPerformed: typeof raw.sourceWritesPerformed === "number" ? raw.sourceWritesPerformed : 0,
  };
}

// ---------------------------------------------------------------------------
// System & Maintenance (Cleanup, Federation, Update Automation)
// ---------------------------------------------------------------------------

export type CleanupItem = {
  id: string;
  label: string;
  desc: string;
  bytes: number;
  available: boolean;
};

export type CleanupPreview = {
  items: CleanupItem[];
  previewId: string;
  expiresAt: string;
  protectedTargets: string[];
};

export type CleanupRunResult = {
  id: string;
  ok: boolean;
  freedBytes: number;
  error?: string;
};

export type FederationStatus = {
  running: boolean;
  connected: boolean;
  lastPollAt?: number;
  lastHeartbeatAt?: number;
  lastSuccessAt?: number;
  lastError?: string;
  currentRequestId?: string;
  lastRequestId?: string;
  lastOutcome?: "idle" | "succeeded" | "failed";
  consecutiveFailures: number;
  nextPollInMs?: number;
  batonProject?: string;
  msoToolCount: number;
  siCoderFunctionCount?: number;
  siCoderVersion?: string;
};

export type UpdateAutomationView = {
  prefs: { auto: boolean; channel: "stable" | "main" };
  timer: { installed: boolean; enabled: boolean; active: boolean; nextRun: string | null };
  active: boolean;
  last: {
    lastAttemptAt: number | null;
    lastResult: "ok" | "failed" | "skipped" | null;
    consecutiveFailures: number;
    detail: string | null;
    channel: "stable" | "main" | null;
  };
  drift: string | null;
  supported: boolean;
  reason: string | null;
};

export async function readCleanupPreview(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<CleanupPreview> {
  const raw = await requestJson("/api/v1/sys/cleanup", {
    label: "storage cleanup preview",
    timeoutMs: 30_000,
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || !Array.isArray(raw.items) || !isRecord(raw.preview) || typeof raw.preview.id !== "string") {
    throw new ApiError("The storage cleanup preview response is invalid.", 502);
  }
  const items: CleanupItem[] = raw.items.flatMap((row): CleanupItem[] => {
    if (!isRecord(row) || typeof row.id !== "string") return [];
    return [{
      id: row.id,
      label: typeof row.label === "string" ? row.label : row.id,
      desc: typeof row.desc === "string" ? row.desc : "",
      bytes: typeof row.bytes === "number" && Number.isFinite(row.bytes) ? row.bytes : 0,
      available: Boolean(row.available),
    }];
  });
  return {
    items,
    previewId: raw.preview.id,
    expiresAt: typeof raw.preview.expiresAt === "string" ? raw.preview.expiresAt : "",
    protectedTargets: Array.isArray(raw.protected)
      ? raw.protected.filter((p): p is string => typeof p === "string")
      : [],
  };
}

export async function runCleanupSelection(
  previewId: string,
  ids: string[],
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<CleanupRunResult[]> {
  const raw = await requestJson("/api/v1/sys/cleanup", {
    method: "POST",
    body: { ids, preview_id: previewId, confirm: true },
    label: "storage cleanup",
    timeoutMs: 60_000,
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || !Array.isArray(raw.results)) {
    throw new ApiError("The storage cleanup response is invalid.", 502);
  }
  return raw.results.flatMap((row): CleanupRunResult[] => {
    if (!isRecord(row) || typeof row.id !== "string") return [];
    return [{
      id: row.id,
      ok: Boolean(row.ok),
      freedBytes: typeof row.freedBytes === "number" ? row.freedBytes : 0,
      ...(typeof row.error === "string" ? { error: row.error } : {}),
    }];
  });
}

export async function readFederationStatus(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<FederationStatus> {
  const raw = await requestJson("/api/v1/federation/status", {
    label: "federation status",
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || typeof raw.running !== "boolean" || typeof raw.connected !== "boolean") {
    throw new ApiError("The federation status response is invalid.", 502);
  }
  const outcome =
    raw.lastOutcome === "idle" || raw.lastOutcome === "succeeded" || raw.lastOutcome === "failed"
      ? raw.lastOutcome
      : undefined;
  return {
    running: raw.running,
    connected: raw.connected,
    ...(typeof raw.lastPollAt === "number" ? { lastPollAt: raw.lastPollAt } : {}),
    ...(typeof raw.lastHeartbeatAt === "number" ? { lastHeartbeatAt: raw.lastHeartbeatAt } : {}),
    ...(typeof raw.lastSuccessAt === "number" ? { lastSuccessAt: raw.lastSuccessAt } : {}),
    ...(typeof raw.lastError === "string" ? { lastError: raw.lastError } : {}),
    ...(typeof raw.currentRequestId === "string" ? { currentRequestId: raw.currentRequestId } : {}),
    ...(typeof raw.lastRequestId === "string" ? { lastRequestId: raw.lastRequestId } : {}),
    ...(outcome ? { lastOutcome: outcome } : {}),
    consecutiveFailures: typeof raw.consecutiveFailures === "number" ? raw.consecutiveFailures : 0,
    ...(typeof raw.nextPollInMs === "number" ? { nextPollInMs: raw.nextPollInMs } : {}),
    ...(typeof raw.batonProject === "string" ? { batonProject: raw.batonProject } : {}),
    msoToolCount: typeof raw.msoToolCount === "number" ? raw.msoToolCount : 0,
    ...(typeof raw.siCoderFunctionCount === "number" ? { siCoderFunctionCount: raw.siCoderFunctionCount } : {}),
    ...(typeof raw.siCoderVersion === "string" ? { siCoderVersion: raw.siCoderVersion } : {}),
  };
}

function parseUpdateAutomation(raw: unknown): UpdateAutomationView {
  if (!isRecord(raw) || !isRecord(raw.prefs) || !isRecord(raw.timer)) {
    throw new ApiError("The update automation response is invalid.", 502);
  }
  const lastRaw = isRecord(raw.last) ? raw.last : {};
  const lastResult =
    lastRaw.lastResult === "ok" || lastRaw.lastResult === "failed" || lastRaw.lastResult === "skipped"
      ? lastRaw.lastResult
      : null;
  const lastChannel = lastRaw.channel === "main" || lastRaw.channel === "stable" ? lastRaw.channel : null;
  return {
    prefs: {
      auto: Boolean(raw.prefs.auto),
      channel: raw.prefs.channel === "main" ? "main" : "stable",
    },
    timer: {
      installed: Boolean(raw.timer.installed),
      enabled: Boolean(raw.timer.enabled),
      active: Boolean(raw.timer.active),
      nextRun: typeof raw.timer.nextRun === "string" ? raw.timer.nextRun : null,
    },
    active: Boolean(raw.active),
    last: {
      lastAttemptAt: typeof lastRaw.lastAttemptAt === "number" ? lastRaw.lastAttemptAt : null,
      lastResult,
      consecutiveFailures: typeof lastRaw.consecutiveFailures === "number" ? lastRaw.consecutiveFailures : 0,
      detail: typeof lastRaw.detail === "string" ? lastRaw.detail : null,
      channel: lastChannel,
    },
    drift: typeof raw.drift === "string" ? raw.drift : null,
    supported: raw.supported !== false,
    reason: typeof raw.reason === "string" ? raw.reason : null,
  };
}

export async function readUpdateAutomation(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<UpdateAutomationView> {
  const raw = await requestJson("/api/v1/sys/update/automation", {
    label: "update automation",
    signal,
    fetcher,
    bridge,
  });
  return parseUpdateAutomation(raw);
}

export async function saveUpdateAutomation(
  patch: { auto?: boolean; channel?: "stable" | "main" },
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<UpdateAutomationView> {
  const raw = await requestJson("/api/v1/sys/update/automation", {
    method: "POST",
    body: { updates: patch },
    label: "update automation",
    timeoutMs: 30_000,
    signal,
    fetcher,
    bridge,
  });
  return parseUpdateAutomation(raw);
}

// ---------------------------------------------------------------------------
// About & Structured Changelog (Zero HTML)
// ---------------------------------------------------------------------------

export type ChangelogEntry = { scope: string; text: string };
export type ChangelogGroup = { label: string; entries: ChangelogEntry[] };
export type ChangelogDay = { date: string; groups: ChangelogGroup[] };

const DAY_RE = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/;
const GROUP_RE = /^\*\*(.+?)\*\*\s*$/;
const ENTRY_RE = /^[-*]\s+(.*)$/;
const SCOPE_RE = /^`([^`]+)`\s*(.*)$/;

export function parseChangelog(markdown: string): ChangelogDay[] {
  const days: ChangelogDay[] = [];
  let day: ChangelogDay | null = null;
  let group: ChangelogGroup | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const dayMatch = DAY_RE.exec(line);
    if (dayMatch) {
      day = { date: dayMatch[1], groups: [] };
      days.push(day);
      group = null;
      continue;
    }
    if (!day) continue;

    const groupMatch = GROUP_RE.exec(line);
    if (groupMatch) {
      group = { label: groupMatch[1], entries: [] };
      day.groups.push(group);
      continue;
    }

    const entryMatch = ENTRY_RE.exec(line);
    if (!entryMatch) continue;
    if (!group) {
      group = { label: "Changed", entries: [] };
      day.groups.push(group);
    }
    const scoped = SCOPE_RE.exec(entryMatch[1].trim());
    group.entries.push(
      scoped
        ? { scope: scoped[1], text: scoped[2].trim() }
        : { scope: "", text: entryMatch[1].trim() },
    );
  }

  return days.filter((d) => d.groups.some((g) => g.entries.length > 0));
}

export async function readChangelog(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<{ markdown: string; generated: boolean; days: ChangelogDay[] }> {
  const raw = await requestJson("/api/changelog", { label: "changelog", signal, fetcher, bridge });
  if (!isRecord(raw) || typeof raw.markdown !== "string") {
    throw new ApiError("The changelog response is invalid.", 502);
  }
  return {
    markdown: raw.markdown,
    generated: Boolean(raw.generated),
    days: parseChangelog(raw.markdown),
  };
}
