import type { TenantCredentialBinding } from "@/lib/tenancy/types";
import type { Scope } from "./scope";
import type { McpToolProfile } from "./tool-contract";

export interface McpClient {
  name: string;
  redirectUris: string[];
  profile?: McpToolProfile;
  createdAt: number;
}

export interface McpCode {
  tenantBinding?: Readonly<TenantCredentialBinding>;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: Scope;
  resource?: string;
  profile?: McpToolProfile;
  offlineAccess?: boolean;
  expiresAt: number;
}

export interface McpToken {
  tenantBinding?: Readonly<TenantCredentialBinding>;
  /** Deprecated marker: subject-only credentials are rejected, never automatically upgraded. */
  tenantSubject?: string;
  label: string;
  clientId: string;
  scope: Scope;
  resource?: string;
  profile?: McpToolProfile;
  allowedTools?: string[];
  toolArgumentConstraints?: Record<string, Record<string, string[]>>;
  grantId?: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

export interface McpRefreshToken {
  lastRotatedAt?: number;
  tenantBinding?: Readonly<TenantCredentialBinding>;
  grantId: string;
  clientId: string;
  scope: Scope;
  resource: string;
  profile?: McpToolProfile;
  offlineAccess?: boolean;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number;
}

export interface McpSpentRefreshToken {
  grantId: string;
  clientId: string;
  resource: string;
  expiresAt: number;
}

export interface McpStore {
  clients: Record<string, McpClient>;
  codes: Record<string, McpCode>;
  tokens: Record<string, McpToken>;
  refreshTokens: Record<string, McpRefreshToken>;
  spentRefreshTokens: Record<string, McpSpentRefreshToken>;
}

export interface TokenView extends McpToken {
  id: string;
  status: "active" | "revoked" | "expired";
}
