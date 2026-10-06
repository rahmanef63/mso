import { createTenantAuthority } from "./authority";
import type { TenantAddress, TenantBinding, TenantStoredValue, TenantStoragePort } from "./types";

export function tenantFixture() {
  let now = 1000;
  const bindings: Record<string, TenantBinding> = {
    alice: { tenantId: "tenant-a", principalId: "principal-a", mappingRevision: 1, enabled: true, tenantEnabled: true },
    bob: { tenantId: "tenant-b", principalId: "principal-b", mappingRevision: 1, enabled: true, tenantEnabled: true },
  };
  const reads: TenantAddress[] = [];
  let override: ((address: Readonly<TenantAddress>) => TenantStoredValue | null) | undefined;
  const storage: TenantStoragePort = {
    read: async (address) => {
      reads.push({ ...address });
      return override ? override(address) : { ...address, value: address.tenantId + ":" + address.key };
    },
  };
  const authority = createTenantAuthority({
    resolve: async (identity) => identity.issuer === "mso-local" && bindings[identity.subject]
      ? { ...bindings[identity.subject] } : null,
  }, storage, () => now);
  return { authority, bindings, reads, storage,
    identity: (subject = "alice") => ({ issuer: "mso-local", subject, expiresAt: 5000 }),
    setNow: (value: number) => { now = value; },
    overrideRead: (value: typeof override) => { override = value; },
  };
}
