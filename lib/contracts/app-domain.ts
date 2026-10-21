// Single server-side source of truth for the shell-app domain shape. The provider layer
// (`lib/infra/managed-domain-providers.ts`) and the provisioning layer
// (`lib/surfaces/app-domain-provision.ts`) import these; neither re-declares them.
// The browser cannot import this module, so `frontend/slices/app-store/lib/app-domain.ts`
// mirrors it — same field names, same union members — and a parity test fails on drift.
export const DOMAIN_PROVIDER_IDS = ["cloudflare", "hostinger", "dokploy", "custom"] as const;
export type DomainProviderId = (typeof DOMAIN_PROVIDER_IDS)[number];
export type DomainProviderCapability = {
  id: DomainProviderId;
  /** Provider can create/update an A record pointing at a public IPv4. */
  aRecord: boolean;
  /** Provider can create/update a CNAME. */
  cname: boolean;
  /** Provider can create/update a TXT challenge record (ownership proof). */
  txt: boolean;
  /** Provider owns the ingress (proxy/tunnel), so no separate route step is needed. */
  ingress: boolean;
};
export type AppDomainPhase = "pending" | "dns-ready" | "route-ready" | "ready" | "blocked";
export type AppDomainTarget = { kind: "ipv4"; value: string } | { kind: "cname"; value: string };
export type AppDomainRecord = {
  appId: string; hostname: string; phase: AppDomainPhase; provider: DomainProviderId | null;
  dnsAction?: "created" | "updated" | "unchanged"; routeAction?: "created" | "unchanged";
  /** Set when phase === "blocked": a bounded, redacted operator-facing reason. */
  error?: string;
  /** Loopback origin probed before any public DNS write. */
  localOrigin?: string; verifiedAt?: number; updatedAt: number;
};
export type EnsureShellAppDomainInput = { provider: DomainProviderId; hostname: string; target: AppDomainTarget; zoneName?: string };
export type AppDomainErrorCode = "invalid_hostname" | "invalid_target" | "unsupported_provider" | "domain_conflict" | "provider_unavailable" | "app_not_found";
