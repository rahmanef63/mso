import { rateLimited } from "@/lib/host/rate-limit";
import type { McpTool } from "./tool-kit";

/** Shared per-tool bucket semantics for direct MCP calls and server-side read pipelines. */
export function toolRateLimited(
  tool: McpTool,
  args: Record<string, unknown>,
  actor?: string,
): boolean {
  if (!tool.limit) return false;
  const suffix = tool.limit.keyArg ? String(args[tool.limit.keyArg] ?? "") : (actor ?? "mcp");
  return rateLimited(`${tool.limit.key}:${suffix}`, tool.limit.max, tool.limit.windowMs);
}
