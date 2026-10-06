import { createHash } from "node:crypto";
import type { AuthenticatedSubject, TenantBinding, TenantRegistryPort, TenantStoragePort } from "./types";

export interface TenantContext { readonly kind: "tenant-preview"; }
type Record = {
  identity: Readonly<AuthenticatedSubject>;
  binding: Readonly<TenantBinding>;
  registry: TenantRegistryPort;
  storage: TenantStoragePort;
  now: () => number;
};
const contexts = new WeakMap<TenantContext, Record>();
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
export class TenantDenied extends Error {
  constructor(message = "tenant request denied") { super(message); this.name = "TenantDenied"; }
}
function validBinding(value: TenantBinding | null): value is TenantBinding {
  return Boolean(value && id(value.tenantId) && id(value.principalId) && value.enabled === true
    && value.tenantEnabled === true && Number.isSafeInteger(value.mappingRevision) && value.mappingRevision > 0);
}
type BindingKey = Pick<TenantBinding, "tenantId" | "principalId" | "mappingRevision">;
function sameBinding(a: Readonly<BindingKey>, b: Readonly<BindingKey>) {
  return a.tenantId === b.tenantId && a.principalId === b.principalId && a.mappingRevision === b.mappingRevision;
}
export function createTenantAuthority(registry: TenantRegistryPort, storage: TenantStoragePort, now = Date.now) {
  return Object.freeze({
    async authenticate(identity: AuthenticatedSubject, expected?: Readonly<BindingKey>): Promise<TenantContext> {
      const pinned = expected === undefined ? undefined : Object.freeze({ ...expected });
      if (pinned && !validBinding({ ...pinned, enabled: true, tenantEnabled: true })) throw new TenantDenied();
      if (!id(identity.issuer) || !id(identity.subject) || !Number.isFinite(identity.expiresAt) || identity.expiresAt <= now()) {
        throw new TenantDenied();
      }
      const copy = Object.freeze({ ...identity });
      const binding = await registry.resolve(copy);
      if (!validBinding(binding) || (pinned && !sameBinding(binding, pinned)) || copy.expiresAt <= now()) throw new TenantDenied();
      const context = Object.freeze({ kind: "tenant-preview" as const });
      contexts.set(context, { identity: copy, binding: Object.freeze({ ...binding }), registry, storage, now });
      return context;
    },
  });
}
export async function tenantAccess(context: TenantContext) {
  const record = contexts.get(context);
  if (!record || record.identity.expiresAt <= record.now()) throw new TenantDenied();
  const live = await record.registry.resolve(record.identity);
  if (!validBinding(live) || !sameBinding(record.binding, live) || record.identity.expiresAt <= record.now()) throw new TenantDenied();
  return { identity: record.identity, binding: record.binding, storage: record.storage };
}
export async function tenantPrincipal(context: TenantContext): Promise<string> {
  const { binding } = await tenantAccess(context);
  const digest = createHash("sha256").update(JSON.stringify([binding.tenantId, binding.principalId])).digest("hex");
  return "tenant:" + digest;
}
