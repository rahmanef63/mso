import type { Scope } from "./scope";
import type { McpToolProfile } from "./tool-contract";

export interface McpClient {
  name: string;
  redirectUris: string[];
  profile?: McpToolProfile;
  createdAt: number;
}

export interface McpCode {
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

export interface McpStore {
  clients: Record<string, McpClient>;
  codes: Record<string, McpCode>;
  tokens: Record<string, McpToken>;
  refreshTokens: Record<string, McpRefreshToken>;
}

export interface TokenView extends McpToken {
  id: string;
  status: "active" | "revoked" | "expired";
}
