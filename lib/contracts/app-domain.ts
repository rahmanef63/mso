// Shared shell-app domain shape. Contract 1 (`lib/infra/` provider worker) declares the same
// provider union; it re-uses this one so there is exactly one spelling of the four providers.
export type DomainProviderId = "cloudflare" | "hostinger" | "dokploy" | "custom";
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
