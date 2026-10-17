export interface ManagedDomainConfig {
  publicOrigin: string;
  hostTemplate: string;
  localOrigin: string;
  zoneId: string;
  zoneName: string;
  accountId: string;
  tunnelId: string;
  user: string;
  connection: string;
  autoProvision: boolean;
  routeMode?: "remote" | "mso-gateway";
}

export type ManagedDomainPhase = "pending" | "dns-ready" | "route-ready" | "ready" | "blocked";

export interface ManagedDomainRecord {
  appId: string;
  hostname: string;
  phase: ManagedDomainPhase;
  dnsRecordId?: string;
  dnsAction?: "created" | "updated" | "unchanged";
  routeAction?: "created" | "unchanged";
  error?: string;
  verifiedAt?: number;
  updatedAt: number;
}

export interface ManagedDomainState {
  version: 1;
  revision: number;
  ownerId: string;
  config: ManagedDomainConfig | null;
  apps: Record<string, ManagedDomainRecord>;
}

export interface ManagedDomainRoute {
  hostname: string;
  hostTemplate?: string;
  cockpitHostname: string;
  localOrigin: string;
  zoneId: string;
  zoneName: string;
  accountId: string;
  tunnelId: string;
  ownerTag: string;
  routeMode?: "remote" | "mso-gateway";
}

export interface ManagedDomainDnsResult {
  id: string;
  action: "created" | "updated" | "unchanged";
}
