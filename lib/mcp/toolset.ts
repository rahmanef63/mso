import { createHash } from "crypto";
import type { Scope } from "./scope";
import type { McpTool } from "./tool-kit";

export const MCP_SERVER_VERSION = "1.6.0";
export const MCP_TOOLSET_VERSION = "2026.09.03.1";
export const MCP_TOOLSET_CHANGED_AT = "2026-09-02T20:10:00Z";

export type McpToolsetInfo = {
  serverVersion: string;
  version: string;
  hash: string;
  changedAt: string;
  scope?: Scope;
  toolCount: number;
  byScope: Record<Scope, number>;
  names: string[];
};

export function toolsetInfo(tools: readonly McpTool[], scope?: Scope): McpToolsetInfo {
  const rows = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  const hashInput = rows.map((tool) => ({
    name: tool.name,
    description: tool.description,
    scope: tool.scope,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: tool.annotations,
    meta: tool.meta,
    result: tool.result,
    limit: tool.limit,
  }));
  const hash = createHash("sha256").update(JSON.stringify(hashInput)).digest("hex").slice(0, 16);
  const byScope: Record<Scope, number> = { read: 0, write: 0, exec: 0 };
  for (const tool of rows) byScope[tool.scope] += 1;
  return {
    serverVersion: MCP_SERVER_VERSION,
    version: MCP_TOOLSET_VERSION,
    hash,
    changedAt: MCP_TOOLSET_CHANGED_AT,
    ...(scope ? { scope } : {}),
    toolCount: rows.length,
    byScope,
    names: rows.map((tool) => tool.name),
  };
}
