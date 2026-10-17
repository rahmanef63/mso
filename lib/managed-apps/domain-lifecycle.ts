import type { ManagedDomainRecord } from "@/lib/contracts/managed-domains";
import { redactText } from "@/lib/security/redact-text";
import { managedDomainHostname } from "./domain-config";
import { ensureManagedAppDomain } from "./domain-provision";
import { readManagedDomains } from "./domain-store";
import type { ManagedAppId } from "./types";

export interface ManagedDomainView {
  domain: ManagedDomainRecord | null;
  domainDiagnostic: string | null;
}
const diagnostic = (error: unknown) => redactText(error instanceof Error ? error.message : "managed-domain configuration is unavailable", 512);

export async function readManagedDomainView(id: ManagedAppId): Promise<ManagedDomainView> {
  try {
    const state = await readManagedDomains();
    const domain = state.apps[id] ?? (state.config ? {
      appId: id, hostname: managedDomainHostname(state.config, id), phase: "pending" as const, updatedAt: 0,
    } : null);
    return { domain, domainDiagnostic: domain?.error ?? null };
  } catch (error) { return { domain: null, domainDiagnostic: diagnostic(error) }; }
}

/** Preserve application success while reporting DNS/configuration failures separately. */
export async function provisionDomainAfterStart(id: ManagedAppId): Promise<ManagedDomainView> {
  try {
    const domain = await ensureManagedAppDomain(id, true);
    return { domain, domainDiagnostic: domain?.error ?? null };
  } catch (error) { return { domain: null, domainDiagnostic: diagnostic(error) }; }
}

export async function appendDomainProvisioning(id: ManagedAppId, append: (text: string) => void): Promise<void> {
  const { domain, domainDiagnostic } = await provisionDomainAfterStart(id);
  if (domain) append(`[mso domain] ${domain.hostname}: ${domain.phase}\n`);
  if (domainDiagnostic) append(`[mso domain] ${domainDiagnostic}; retry: mso domain ensure ${id} --apply\n`);
}
