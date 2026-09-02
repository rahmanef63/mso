import { rateLimited } from "@/lib/host/rate-limit";
import type { CapabilityTool } from "./tool";

export function capabilityRateLimited(
  tool: CapabilityTool,
  args: Record<string, unknown>,
  actor?: string,
): boolean {
  if (!tool.limit) return false;
  const suffix = tool.limit.keyArg ? String(args[tool.limit.keyArg] ?? "") : (actor ?? "mcp");
  return rateLimited(`${tool.limit.key}:${suffix}`, tool.limit.max, tool.limit.windowMs);
}
