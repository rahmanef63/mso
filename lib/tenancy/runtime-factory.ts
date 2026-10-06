import { createTenantAuthority, tenantAccess, TenantDenied, type TenantContext } from "./authority";
import { credentialMatchesBinding, tenantCredentialFields } from "./credentials";
import type { TenantRegistryPort, TenantStoragePort } from "./types";

export interface VerifiedTenantToken {
  tenantSubject?: unknown;
  tenantBinding?: unknown;
  expiresAt: number;
  revokedAt?: number;
}
export function createTenantRuntime(dependencies: {
  registry: TenantRegistryPort;
  storage: TenantStoragePort;
  verifyAccessToken: (bearer: string) => Promise<VerifiedTenantToken | null>;
  enabled: () => boolean;
  now?: () => number;
}) {
  const now = dependencies.now ?? Date.now;
  const authority = createTenantAuthority(dependencies.registry, dependencies.storage, now);
  async function resolveValidatedToken(token: VerifiedTenantToken): Promise<TenantContext | undefined> {
    const binding = tenantCredentialFields(token).tenantBinding;
    if (!dependencies.enabled()) {
      if (binding) throw new TenantDenied("tenant credential is disabled");
      return undefined;
    }
    if (!binding) throw new TenantDenied("versioned tenant credential is required");
    if (token.revokedAt !== undefined || !Number.isFinite(token.expiresAt) || token.expiresAt <= now()) throw new TenantDenied();
    const context = await authority.authenticate({ issuer: binding.issuer, subject: binding.subject, expiresAt: token.expiresAt }, binding);
    const access = await tenantAccess(context);
    if (!dependencies.enabled() || !credentialMatchesBinding(binding, access.binding)) throw new TenantDenied("tenant credential binding changed");
    return context;
  }
  async function authenticateBearer(bearer: string) {
    if (typeof bearer !== "string" || !bearer || bearer.length > 8192) throw new TenantDenied();
    const token = await dependencies.verifyAccessToken(bearer);
    if (!token) throw new TenantDenied();
    return resolveValidatedToken(token);
  }
  return Object.freeze({ resolveValidatedToken, authenticateBearer });
}
