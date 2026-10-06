import { tenantAccess, TenantDenied, type TenantContext } from "./authority";
import { readTenantMemory } from "./storage";
import { validateMemoryArguments, type TenantMemoryTool } from "./memory-tools";
import type { TenantPublicMemoryPort } from "./types";

export async function invokeTenantMemory(context: TenantContext, tool: TenantMemoryTool, args: Record<string, unknown>) {
  const parsed = validateMemoryArguments(tool, args);
  const access = await tenantAccess(context), port = access.storage as Partial<TenantPublicMemoryPort>;
  if (typeof port.operateMemory !== "function") {
    if (tool === "agent_memory_read") return readTenantMemory(context);
    throw new TenantDenied("tenant memory writes are not configured");
  }
  const result = await port.operateMemory({ identity: access.identity, binding: access.binding }, tool, parsed);
  if (tool === "agent_memory_read" || tool === "agent_memory_search") await tenantAccess(context);
  return result;
}
