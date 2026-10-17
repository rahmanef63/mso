import type { ManagedDomainRecord, ManagedDomainRoute } from "@/lib/contracts/managed-domains";
import { withIntegrationSelection } from "@/lib/infra/connection-service";
import { inspectManagedDomainRoute, ensureManagedDomainDns, ensureManagedDomainRoute } from "@/lib/infra/managed-domain";
import { redactText } from "@/lib/security/redact-text";
import { managedDomainHostname } from "./domain-config";
import { probeManagedAppRuntime } from "./domain-health";
import { probeLocalManagedDomain, probePublicManagedDomain } from "./domain-probe";
import { mutateManagedDomains, readManagedDomains, withManagedDomainOperation } from "./domain-store";
import type { ManagedAppId } from "./types";

export async function ensureManagedAppDomain(id: ManagedAppId, automatic = false): Promise<ManagedDomainRecord | null> {
  const initial = await readManagedDomains();
  if (!initial.config || automatic && !initial.config.autoProvision) return null;
  return withManagedDomainOperation(async () => {
    const state = await readManagedDomains();
    const config = state.config;
    if (!config || automatic && !config.autoProvision) return null;
    const hostname = managedDomainHostname(config, id);
    const route: ManagedDomainRoute = {
      hostname, hostTemplate: config.hostTemplate, cockpitHostname: new URL(config.publicOrigin).hostname, localOrigin: config.localOrigin,
      zoneId: config.zoneId, zoneName: config.zoneName, accountId: config.accountId,
      tunnelId: config.tunnelId, ownerTag: `mso:${state.ownerId}:${id}`,
      routeMode: config.routeMode,
    };
    const current: ManagedDomainRecord = { ...state.apps[id], appId: id, hostname, phase: "pending", updatedAt: Date.now() };
    delete current.error; delete current.verifiedAt;
    const persist = async (patch: Partial<ManagedDomainRecord>) => {
      Object.assign(current, patch, { updatedAt: Date.now() });
      await mutateManagedDomains(next => { next.apps[id] = { ...current }; });
    };
    await persist({ phase: "pending" });
    try {
      // Arm and verify the existing auth router before introducing a public DNS route.
      await probeLocalManagedDomain(config, hostname, id);
      await withIntegrationSelection({ user: config.user, connection: config.connection }, async () => {
        await inspectManagedDomainRoute(route);
        // The authenticated ingress must be active before DNS can make the name public.
        const ingress = await ensureManagedDomainRoute(route);
        await persist({ phase: "route-ready", routeAction: ingress.action });
        const dns = await ensureManagedDomainDns(route);
        await persist({ phase: "dns-ready", dnsRecordId: dns.id, dnsAction: dns.action });
      });
      await probeManagedAppRuntime(id);
      await probePublicManagedDomain(hostname, id);
      await persist({ phase: "ready", verifiedAt: Date.now() });
    } catch (error) {
      await persist({ phase: "blocked", error: redactText(error instanceof Error ? error.message : "domain provisioning failed", 512) });
    }
    return { ...current };
  });
}

export async function inspectManagedAppDomain(id: ManagedAppId): Promise<{ configured: boolean; hostname?: string; checks?: Record<string, string> }> {
  const state = await readManagedDomains();
  const config = state.config;
  if (!config) return { configured: false };
  const hostname = managedDomainHostname(config, id);
  const checks: Record<string, string> = {};
  for (const [name, check] of [
    ["local", () => probeLocalManagedDomain(config, hostname, id)],
    ["provider", () => withIntegrationSelection({ user: config.user, connection: config.connection }, () => inspectManagedDomainRoute({
      hostname, hostTemplate: config.hostTemplate, cockpitHostname: new URL(config.publicOrigin).hostname, localOrigin: config.localOrigin,
      zoneId: config.zoneId, zoneName: config.zoneName, accountId: config.accountId, tunnelId: config.tunnelId,
      ownerTag: `mso:${state.ownerId}:${id}`,
      routeMode: config.routeMode,
    }))],
    ["runtime", () => probeManagedAppRuntime(id)],
    ["https", () => probePublicManagedDomain(hostname, id)],
  ] as const) {
    try { await check(); checks[name] = "ok"; }
    catch (error) { checks[name] = redactText(error instanceof Error ? error.message : "check failed", 512); }
  }
  return { configured: true, hostname, checks };
}
