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
