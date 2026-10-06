import { TenantDenied } from "./authority";
import { tenantPreviewEnabled } from "./mode";
import { tenantCredentialFields } from "./credentials";
import { createConfiguredTenantRuntime } from "./configured-runtime";
import { createTenantRuntime, type VerifiedTenantToken } from "./runtime-factory";

const disabled = createTenantRuntime({
  registry: { resolve: async () => { throw new TenantDenied("tenant registry is not configured"); } },
  storage: { read: async () => { throw new TenantDenied("tenant storage is not configured"); } },
  verifyAccessToken: async () => null, enabled: tenantPreviewEnabled,
});
let configured: { root: string; runtime: ReturnType<typeof createConfiguredTenantRuntime> } | undefined;
/** Only transports that have already verified their bearer may pass records here. */
export async function resolveMcpTenant(token: VerifiedTenantToken) {
  if (!tenantPreviewEnabled()) return disabled.resolveValidatedToken(token);
  if (!tenantCredentialFields(token).tenantBinding) throw new TenantDenied("versioned tenant credential is required");
  const root = process.env.OS_TENANCY_STORAGE_ROOT;
  if (!root) throw new TenantDenied("tenant registry is not configured");
  if (configured && configured.root !== root) throw new TenantDenied("tenant root change requires reviewed restart");
  if (!configured) configured = { root, runtime: createConfiguredTenantRuntime({
    storageRoot: root, selectedRoot: () => process.env.OS_TENANCY_STORAGE_ROOT,
    enabled: tenantPreviewEnabled, verifyAccessToken: async () => null,
  }) };
  return (await configured.runtime).resolveValidatedToken(token);
}
export async function authorizeMcpTenantGrant(record: VerifiedTenantToken): Promise<void> {
  await resolveMcpTenant(record);
}
export function tenantRuntimeConfigurationPresent() {
  return Boolean(process.env.OS_TENANCY_STORAGE_ROOT);
}
