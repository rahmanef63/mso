import type { ManagedDomainDnsResult, ManagedDomainRoute } from "@/lib/contracts/managed-domains";
import { inspectManagedDomainIdentity, managedDomainClient } from "./managed-domain-client";
import { inspectManagedDomainDns, reconcileManagedDomainDns } from "./managed-domain-dns";
import { ensureManagedDomainGateway, inspectManagedDomainGateway } from "./managed-domain-gateway";
import { inspectRemoteManagedDomain, reconcileRemoteManagedDomain } from "./managed-domain-route";

export async function inspectManagedDomainRoute(input: ManagedDomainRoute): Promise<void> {
  const client = await managedDomainClient(input);
  const mode = await inspectManagedDomainIdentity(client, input);
  if (mode === "mso-gateway") await inspectManagedDomainGateway(input);
  else await inspectRemoteManagedDomain(client, input);
  await inspectManagedDomainDns(client, input);
}

export async function ensureManagedDomainDns(input: ManagedDomainRoute): Promise<ManagedDomainDnsResult> {
  const client = await managedDomainClient(input);
  await inspectManagedDomainIdentity(client, input);
  return reconcileManagedDomainDns(client, input);
}

export async function ensureManagedDomainRoute(input: ManagedDomainRoute): Promise<{ action: "created" | "unchanged" }> {
  const client = await managedDomainClient(input);
  const mode = await inspectManagedDomainIdentity(client, input);
  return mode === "mso-gateway" ? ensureManagedDomainGateway(input) : reconcileRemoteManagedDomain(client, input);
}
