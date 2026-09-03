import { createHash } from "crypto";
import type { Scope } from "./scope";
import type { McpTool } from "./tool-kit";
import { toolDescriptor, type McpToolProfile } from "./tool-contract";

export const MCP_SERVER_VERSION = "1.7.0";
export const MCP_TOOLSET_VERSION = "2026.09.03.4";
export const MCP_TOOLSET_CHANGED_AT = "2026-09-03T10:23:00Z";

export type McpToolsetInfo = {
  serverVersion: string;
  version: string;
  hash: string;
  changedAt: string;
  scope?: Scope;
  profile?: McpToolProfile;
  toolCount: number;
  byScope: Record<Scope, number>;
  names: string[];
};

export function toolsetInfo(tools: readonly McpTool[], scope?: Scope, profile: McpToolProfile = "full"): McpToolsetInfo {
  const rows = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  const hashInput = rows.map((tool) => ({ descriptor: toolDescriptor(tool, profile), scope: tool.scope, result: tool.result, limit: tool.limit }));
  const hash = createHash("sha256").update(JSON.stringify(hashInput)).digest("hex").slice(0, 16);
  const byScope: Record<Scope, number> = { read: 0, write: 0, exec: 0 };
  for (const tool of rows) byScope[tool.scope] += 1;
  return {
    serverVersion: MCP_SERVER_VERSION,
    version: MCP_TOOLSET_VERSION,
    hash,
    changedAt: MCP_TOOLSET_CHANGED_AT,
    ...(scope ? { scope } : {}),
    ...(profile !== "full" ? { profile } : {}),
    toolCount: rows.length,
    byScope,
    names: rows.map((tool) => tool.name),
  };
}
