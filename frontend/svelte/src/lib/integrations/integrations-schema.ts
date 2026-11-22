import { ApiError } from "../host-api.ts";

export type IntegrationUserProfile = { id: string; label: string; isDefault: boolean; connectionCount: number };
export type IntegrationConnectionSource = "direct" | "composio" | "native-mcp";

export type IntegrationConnectionSummary = {
  user: string; id: string; label: string; provider: string; source: IntegrationConnectionSource;
  authMethod: string; scope: string; isDefault: boolean; missing: string[]; state: string;
  verifiedAt: number | null; lastCheckResult: string | null; lastCheckDetail: string | null;
};

export type IntegrationsSnapshot = {
  version: 2; user: string | null; resolution: string;
  users: IntegrationUserProfile[]; connections: IntegrationConnectionSummary[];
};

export type ChannelProviderId = "telegram" | "discord";
export type ChannelProviderInfo = {
  id: ChannelProviderId; title: string; inbound: "webhook" | "interactions";
  sendText: boolean; inboundEvents: boolean;
};
export type ChannelCheckInfo = { at: string; ok: boolean; detail: string };

export type ChannelItem = {
  id: string; name: string; provider: ChannelProviderId;
  credentialUser: string; credentialConnection: string; enabled: boolean;
  defaultTarget: string | null; workflowId: string | null;
  createdAt: string; updatedAt: string; lastCheck: ChannelCheckInfo | null;
  lastActivityAt: string | null; connectionState: string | null; connectionError: string | null;
};

export type ChannelsSnapshot = { version: 1; revision: number; providers: ChannelProviderInfo[]; channels: ChannelItem[] };
export type ChannelTestResult = { ok: boolean; detail: string; checkedAt: string | null };

const SOURCES = new Set<IntegrationConnectionSource>(["direct", "composio", "native-mcp"]);
const CHANNEL_PROVIDERS = new Set<ChannelProviderId>(["telegram", "discord"]);
const INBOUND_MODES = new Set<"webhook" | "interactions">(["webhook", "interactions"]);

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isOptionalStr = (v: unknown): v is string | undefined => v === undefined || typeof v === "string";

export function canonicalProviderId(provider: string): string {
  return provider === "convex-cloud" ? "convex" : provider;
}

function validateUserProfile(item: unknown): IntegrationUserProfile {
  if (!isRecord(item) || !isNonEmpty(item.id) || !isNonEmpty(item.label) || typeof item.isDefault !== "boolean"
      || typeof item.connectionCount !== "number" || !Number.isInteger(item.connectionCount) || item.connectionCount < 0) {
    throw new ApiError("The MSO integrations response is invalid.", 502);
  }
  return { id: item.id, label: item.label, isDefault: item.isDefault, connectionCount: item.connectionCount };
}

function validateConnection(item: unknown): IntegrationConnectionSummary {
  if (!isRecord(item) || !isNonEmpty(item.user) || !isNonEmpty(item.id) || !isNonEmpty(item.label)
      || !isNonEmpty(item.provider) || !SOURCES.has(item.source as IntegrationConnectionSource)
      || !isNonEmpty(item.authMethod) || !isNonEmpty(item.scope) || typeof item.isDefault !== "boolean"
      || !Array.isArray(item.missing) || !item.missing.every((m) => typeof m === "string")
      || !isNonEmpty(item.state)
      || (item.verifiedAt !== undefined && item.verifiedAt !== null && typeof item.verifiedAt !== "number")) {
    throw new ApiError("The MSO integrations response is invalid.", 502);
  }
  let lastCheckResult: string | null = null;
  let lastCheckDetail: string | null = null;
  if (item.lastCheck !== undefined && item.lastCheck !== null) {
    if (!isRecord(item.lastCheck)
        || (item.lastCheck.result !== undefined && typeof item.lastCheck.result !== "string")
        || (item.lastCheck.detail !== undefined && typeof item.lastCheck.detail !== "string")) {
      throw new ApiError("The MSO integrations response is invalid.", 502);
    }
    lastCheckResult = typeof item.lastCheck.result === "string" ? item.lastCheck.result : null;
    lastCheckDetail = typeof item.lastCheck.detail === "string" ? item.lastCheck.detail : null;
  }
  // Allowlisted metadata fields only; never retain credential values or secret payloads.
  return {
    user: item.user, id: item.id, label: item.label, provider: canonicalProviderId(item.provider),
    source: item.source as IntegrationConnectionSource, authMethod: item.authMethod, scope: item.scope,
    isDefault: item.isDefault, missing: [...item.missing], state: item.state,
    verifiedAt: typeof item.verifiedAt === "number" ? item.verifiedAt : null, lastCheckResult, lastCheckDetail,
  };
}

export function validateIntegrationsSnapshot(value: unknown): IntegrationsSnapshot {
  if (!isRecord(value) || value.version !== 2 || (value.user !== null && typeof value.user !== "string")
      || !isNonEmpty(value.resolution) || !Array.isArray(value.users) || !Array.isArray(value.connections)) {
    throw new ApiError("The MSO integrations response is invalid.", 502);
  }
  return {
    version: 2, user: value.user, resolution: value.resolution,
    users: value.users.map(validateUserProfile), connections: value.connections.map(validateConnection),
  };
}

function validateChannelCheck(raw: unknown): ChannelCheckInfo | null {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw) || !isNonEmpty(raw.at) || typeof raw.ok !== "boolean" || typeof raw.detail !== "string") {
    throw new ApiError("The MSO channels response is invalid.", 502);
  }
  return { at: raw.at, ok: raw.ok, detail: raw.detail };
}

function validateChannelProvider(raw: unknown): ChannelProviderInfo {
  if (!isRecord(raw) || !CHANNEL_PROVIDERS.has(raw.id as ChannelProviderId) || !isNonEmpty(raw.title)
      || !INBOUND_MODES.has(raw.inbound as "webhook" | "interactions")
      || typeof raw.sendText !== "boolean" || typeof raw.inboundEvents !== "boolean") {
    throw new ApiError("The MSO channels response is invalid.", 502);
  }
  return {
    id: raw.id as ChannelProviderId, title: raw.title,
    inbound: raw.inbound as "webhook" | "interactions", sendText: raw.sendText, inboundEvents: raw.inboundEvents,
  };
}

function validateChannelItem(item: unknown): ChannelItem {
  if (!isRecord(item) || !isNonEmpty(item.id) || !isNonEmpty(item.name)
      || !CHANNEL_PROVIDERS.has(item.provider as ChannelProviderId)
      || !isRecord(item.credential) || !isNonEmpty(item.credential.user) || !isNonEmpty(item.credential.connection)
      || typeof item.enabled !== "boolean" || !isOptionalStr(item.defaultTarget) || !isOptionalStr(item.workflowId)
      || !isNonEmpty(item.createdAt) || !isNonEmpty(item.updatedAt) || !isOptionalStr(item.lastActivityAt)) {
    throw new ApiError("The MSO channels response is invalid.", 502);
  }
  let connectionState: string | null = null;
  let connectionError: string | null = null;
  if (item.connection !== undefined && item.connection !== null) {
    if (!isRecord(item.connection) || (item.connection.state !== undefined && typeof item.connection.state !== "string")
        || (item.connection.error !== undefined && typeof item.connection.error !== "string")) {
      throw new ApiError("The MSO channels response is invalid.", 502);
    }
    connectionState = typeof item.connection.state === "string" ? item.connection.state : null;
    connectionError = typeof item.connection.error === "string" ? item.connection.error : null;
  }
  return {
    id: item.id, name: item.name, provider: item.provider as ChannelProviderId,
    credentialUser: item.credential.user, credentialConnection: item.credential.connection,
    enabled: item.enabled, defaultTarget: item.defaultTarget ?? null, workflowId: item.workflowId ?? null,
    createdAt: item.createdAt, updatedAt: item.updatedAt, lastCheck: validateChannelCheck(item.lastCheck),
    lastActivityAt: item.lastActivityAt ?? null, connectionState, connectionError,
  };
}

export function validateChannelsSnapshot(value: unknown): ChannelsSnapshot {
  if (!isRecord(value) || value.version !== 1
      || typeof value.revision !== "number" || !Number.isInteger(value.revision) || value.revision < 0
      || !Array.isArray(value.channels) || (value.providers !== undefined && !Array.isArray(value.providers))) {
    throw new ApiError("The MSO channels response is invalid.", 502);
  }
  return {
    version: 1, revision: value.revision,
    providers: Array.isArray(value.providers) ? value.providers.map(validateChannelProvider) : [],
    channels: value.channels.map(validateChannelItem),
  };
}

export function validateChannelTestResult(value: unknown): ChannelTestResult {
  if (!isRecord(value) || typeof value.ok !== "boolean" || typeof value.detail !== "string") {
    throw new ApiError("The MSO channel test response is invalid.", 502);
  }
  let checkedAt: string | null = null;
  if (value.channel !== undefined && value.channel !== null) {
    if (!isRecord(value.channel)) throw new ApiError("The MSO channel test response is invalid.", 502);
    checkedAt = validateChannelCheck(value.channel.lastCheck)?.at ?? null;
  }
  return { ok: value.ok, detail: value.detail, checkedAt };
}
