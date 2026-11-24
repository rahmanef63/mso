import { ApiError } from "../host-api.ts";
import { detectShellBridge } from "../shell-bridge.ts";
import type { ShellBridge } from "../shell-bridge.ts";
import { isRecord, requestJson } from "./settings-request.ts";

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

export type * from "./settings-mcp-types.ts";
export { normalizeMcpOrigin } from "./settings-mcp-origin.ts";
export { buildMcpClientGuides } from "./settings-mcp-guides.ts";
import type { McpActivityEntry, McpScope, McpStatusPayload, McpTokenRow } from "./settings-mcp-types.ts";

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
