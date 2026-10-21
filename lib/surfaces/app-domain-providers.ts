import type { AppDomainTarget, DomainProviderId } from "@/lib/contracts/app-domain";

/**
 * Contract 1 (`lib/infra/managed-domain-providers.ts`) is owned by a separate worker and is
 * not in this checkout. It is named HERE and nowhere else, as a narrow type-only seam, so the
 * rest of the feature compiles against the declared contract and tests inject a fake.
 *
 * Merge step (one file): replace `setDomainProviders`/`domainProviders` with a static import
 * of the same three functions from that module and delete the seam type below. Until then an
 * un-injected process fails closed with `provider_unavailable`; it never guesses a provider.
 */
export type DomainProviderSeam = {
  domainProviderCapabilities(id: DomainProviderId): { aRecord: boolean; cname: boolean; ingress: boolean };
  ensureDomainRecords(input: { provider: DomainProviderId; zoneName: string; hostnames: string[]; target: AppDomainTarget }):
    Promise<{ action: "created" | "updated" | "unchanged" }>;
  inspectDomainRecords(input: { provider: DomainProviderId; zoneName: string; hostnames: string[]; target: AppDomainTarget }):
    Promise<"created" | "updated" | "unchanged">;
};

let installed: DomainProviderSeam | null = null;

/** Wire the provider module once at composition time (tests and the Contract 1 merge). */
export function setDomainProviders(module: DomainProviderSeam | null): void { installed = module; }

/** Installed provider module, or null when this build does not ship Contract 1. */
export const domainProviders = (): DomainProviderSeam | null => installed;
