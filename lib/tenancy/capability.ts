import { tenantPrincipal, TenantDenied, type TenantContext } from "./authority";
import { tenantPreviewEnabled } from "./mode";
import { invokeTenantMemory } from "./public-memory";
import { tenantMemoryTool } from "./memory-tools";

export async function tenantCapabilityPlan(context: TenantContext | undefined, tool: string) {
  if (!tenantPreviewEnabled()) {
    if (context) throw new TenantDenied("tenant context is disabled");
    return null;
  }
  if (!context) throw new TenantDenied("tenant context is required");
  const principal = await tenantPrincipal(context);
  if (!tenantMemoryTool(tool)) throw new TenantDenied("capability is not implemented for tenant preview");
  return { principal, run: (args: Record<string, unknown>) => invokeTenantMemory(context, tool, args) };
}
