import { TenantDenied } from "./authority";
import { openTenantPersistence } from "./persistence";
import { createTenantRuntime, type VerifiedTenantToken } from "./runtime-factory";

export async function createConfiguredTenantRuntime(config: {
  storageRoot: string;
  enabled: () => boolean;
  selectedRoot: () => string | undefined;
  verifyAccessToken: (bearer: string) => Promise<VerifiedTenantToken | null>;
}) {
  const root = config.storageRoot;
  const selected = () => {
    if (!config.enabled() || config.selectedRoot() !== root) throw new TenantDenied("tenant runtime configuration changed");
  };
  selected();
  const backend = await openTenantPersistence({ root, initialize: false, guard: selected });
  selected();
  return createTenantRuntime({
    enabled: config.enabled,
    verifyAccessToken: config.verifyAccessToken,
    storage: backend.storage,
    registry: { resolve: async identity => {
      selected();
      const binding = await backend.registry.resolve(identity);
      selected();
      return binding;
    } },
  });
}
