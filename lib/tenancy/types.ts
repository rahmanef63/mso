import type { TenantMemoryTool } from "./memory-tools";
export type TenantCollection = "memory" | "sessions" | "jobs" | "projects" | "artifacts" | "backups";
export interface AuthenticatedSubject { issuer: string; subject: string; expiresAt: number; }
export interface TenantBinding {
  tenantId: string;
  principalId: string;
  mappingRevision: number;
  enabled: boolean;
  tenantEnabled: boolean;
}
export interface TenantRegistryPort {
  resolve(identity: Readonly<AuthenticatedSubject>): Promise<TenantBinding | null>;
}
export interface TenantAddress {
  tenantId: string;
  principalId: string;
  mappingRevision: number;
  collection: TenantCollection;
  key: string;
}
export interface TenantStoredValue extends TenantAddress { value: unknown; }
export interface TenantStoragePort {
  /** Implementations must scope lookup by every address field; never fall back to owner/global data. */
  read(address: Readonly<TenantAddress>): Promise<TenantStoredValue | null>;
}

export interface TenantMemoryWritePort extends TenantStoragePort {
  writeMemory(grant: { identity: Readonly<AuthenticatedSubject>; binding: Readonly<TenantBinding> },
    key: "USER.md" | "MEMORY.md", value: string, expectedStoreRevision: number, expectedDocumentVersion: number):
    Promise<{ result: { version: number }; revision: number; operationId: string }>;
}

export type TenantAuditEvent = {
  id: string; revision: number; at: string; tenantId: string; principalId: string;
  mappingRevision: number; scope: "principal" | "tenant";
  action: "binding.changed" | "memory.written"; key?: string; tool?: TenantMemoryTool;
};
export type TenantAuditView = Omit<TenantAuditEvent, "principalId"> & { principalId?: string };
export interface TenantAuditPort {
  read(binding: Readonly<TenantBinding>): Promise<TenantAuditView[]>;
}

export interface TenantCredentialBinding {
  version: 1;
  issuer: string;
  subject: string;
  tenantId: string;
  principalId: string;
  mappingRevision: number;
}

export type TenantGrant = { identity: Readonly<AuthenticatedSubject>; binding: Readonly<TenantBinding> };
export interface TenantPublicMemoryPort extends TenantMemoryWritePort {
  operateMemory(grant: TenantGrant, tool: TenantMemoryTool, args: Readonly<Record<string, unknown>>): Promise<unknown>;
}
