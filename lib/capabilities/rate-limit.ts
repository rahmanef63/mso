import { rateLimited } from "@/lib/host/rate-limit";
import type { CapabilityTool } from "./tool";

export function capabilityRateLimited(
  tool: CapabilityTool,
  args: Record<string, unknown>,
  actor?: string,
): boolean {
  if (!tool.limit) return false;
  const suffix = tool.limit.keyArg ? String(args[tool.limit.keyArg] ?? "") : (actor ?? "mcp");
  // Only explicitly declared action budgets are separate. Invalid/unlisted actions
  // keep consuming the base mutation budget, including prototype-shaped names.
  const action = typeof args.action === "string" ? args.action : "";
  const overrides = tool.limit.actionLimits;
  const specific = overrides && Object.hasOwn(overrides, action) ? overrides[action] : undefined;
  const key = `${tool.limit.key}${specific ? ".action." + action : ""}:${suffix}`;
  return rateLimited(key, specific?.max ?? tool.limit.max, specific?.windowMs ?? tool.limit.windowMs);
}
