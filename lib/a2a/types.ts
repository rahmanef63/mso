import type { Scope } from "@/lib/mcp/scope";

export type A2AStandardBinding = "JSONRPC" | "HTTP+JSON";

export type A2AAgentInterface = {
  url: string;
  protocolBinding: string;
  protocolVersion: string;
  tenant?: string;
};

export type A2AAgentSkill = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  inputModes: string[];
  outputModes: string[];
};

export type A2ASecurityScheme =
  | { kind: "api-key"; location: "header" | "query" | "cookie"; name: string }
  | { kind: "http"; scheme: string; bearerFormat?: string }
  | { kind: "oauth2" }
  | { kind: "openid"; openIdConnectUrl?: string }
  | { kind: "mtls" }
  | { kind: "unknown" };

export type A2AAgentCard = {
  name: string;
  description: string;
  version: string;
  supportedInterfaces: A2AAgentInterface[];
  capabilities: Record<string, boolean>;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2AAgentSkill[];
  securityRequirements: Array<Record<string, unknown>>;
  securitySchemes?: Record<string, A2ASecurityScheme>;
  securitySchemeNames: string[];
  requiresAuthentication: boolean;
};

export type A2ADiscoveredAgent = {
  cardUrl: string;
  card: A2AAgentCard;
  selectedInterface: A2AAgentInterface;
  /** Local-only pointer. The actual secret remains in the private credential store. */
  credentialProfileId?: string;
};

export type A2ARegisteredAgent = {
  id: string;
  alias: string;
  cardUrl: string;
  card: A2AAgentCard;
  credentialProfileId?: string;
  registeredAt: string;
  updatedAt: string;
};

export type A2ASendOptions = {
  contextId?: string;
  taskId?: string;
  returnImmediately?: boolean;
  historyLength?: number;
  metadata?: Record<string, unknown>;
};

export type A2AStreamOptions = A2ASendOptions & { signal?: AbortSignal };

export type A2ACredentialKind = "api-key" | "bearer" | "oauth2";

export type A2AOutboundCredentialSummary = {
  id: string;
  agentId: string;
  label: string;
  kind: A2ACredentialKind;
  schemeName?: string;
  headerName?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type A2AInboundTokenSummary = {
  id: string;
  label: string;
  scope: Scope;
  createdAt: string;
  updatedAt: string;
};
