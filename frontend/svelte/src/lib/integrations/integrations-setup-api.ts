import { ApiError } from "../host-api.ts";
import { detectShellBridge, type ShellBridge } from "../shell-bridge.ts";
import { canonicalProviderId } from "./integrations-schema.ts";
import {
  isNonEmpty, isRecord, requestJson, validateCatalogField, type IntegrationCatalogField,
} from "./integrations-workspace-api.ts";

const SETUP_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type IntegrationSetupField = IntegrationCatalogField & { stored: boolean };
export type IntegrationSetupSchema = {
  provider: string; title: string; methodId: string; label: string; user: string; connection: string;
  source: string; authMethod: string; scope: string; expiresAt: number; stored: string;
  fields: IntegrationSetupField[]; steps: string[];
};
export type IntegrationSetupGrant = { token: string; schema: IntegrationSetupSchema };

function validateSetupSchema(raw: unknown, provider: string): IntegrationSetupSchema {
  if (!isRecord(raw) || !isNonEmpty(raw.title) || !isNonEmpty(raw.method) || !Array.isArray(raw.fields)) {
    throw new ApiError("The MSO secure setup response is invalid.", 502);
  }
  const guidance = isRecord(raw.guidance) ? raw.guidance : null;
  const steps = guidance && Array.isArray(guidance.steps)
    ? guidance.steps.filter((step): step is string => typeof step === "string").slice(0, 8)
    : [];
  return {
    provider: canonicalProviderId(provider), title: raw.title, methodId: raw.method,
    label: isNonEmpty(raw.label) ? raw.label : provider,
    user: isNonEmpty(raw.user) ? raw.user : "",
    connection: isNonEmpty(raw.connection) ? raw.connection : "",
    source: typeof raw.source === "string" ? raw.source : "direct",
    authMethod: isNonEmpty(raw.authMethod) ? raw.authMethod : raw.method,
    scope: typeof raw.scope === "string" ? raw.scope : "",
    expiresAt: typeof raw.expiresAt === "number" ? raw.expiresAt : 0,
    stored: typeof raw.store === "string" ? raw.store : "",
    fields: raw.fields.map((field) => ({
      ...validateCatalogField(field),
      stored: isRecord(field) && field.stored === true,
    })),
    steps,
  };
}

/** Mint a one-time setup grant. The token never reaches a URL, a log or component state. */
export async function openIntegrationSetup(
  input: { provider: string; method: string; user: string; connection: string },
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<IntegrationSetupGrant> {
  const payload = await requestJson("/api/v1/infra/setup", {
    method: "POST", label: "Secure setup", timeoutMs: 30_000,
    body: { provider: input.provider, method: input.method, user: input.user, connection: input.connection },
  }, signal, fetcher, bridge);
  if (!isRecord(payload) || typeof payload.token !== "string" || !SETUP_TOKEN.test(payload.token)) {
    throw new ApiError("The MSO secure setup response is invalid.", 502);
  }
  return { token: payload.token, schema: validateSetupSchema(payload.setup, input.provider) };
}

export async function saveIntegrationSetup(
  token: string, values: Record<string, string>, signal: AbortSignal,
  fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<{ verified: boolean; provider: string }> {
  if (!SETUP_TOKEN.test(token)) throw new ApiError("The secure setup session is no longer valid. Reopen it.", 401);
  const trimmed = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value),
  );
  if (Object.keys(trimmed).length === 0) throw new ApiError("Enter at least one credential value.", 400);
  const payload = await requestJson("/api/integrations/setup", {
    method: "POST", label: "Secure setup save", authToken: token, timeoutMs: 45_000,
    body: { action: "save", values: trimmed },
  }, signal, fetcher, bridge);
  if (!isRecord(payload) || payload.ok !== true) throw new ApiError("The secure setup save response is invalid.", 502);
  return { verified: payload.verified === true, provider: canonicalProviderId(String(payload.provider ?? "")) };
}

const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type CreateConnectionInput = {
  user: string; provider: string; connection: string; label: string; authMethod: string; makeDefault: boolean;
};

/** A named connection is the identity a credential is stored under. It must exist before
 *  the setup grant can target it, so creation is its own confirmed step. */
export async function createIntegrationConnection(
  input: CreateConnectionInput, signal: AbortSignal,
  fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<void> {
  for (const [field, value] of [["profile", input.user], ["connection", input.connection]] as const) {
    if (!IDENTITY.test(value)) throw new ApiError(`Invalid ${field} id. Use letters, digits, dot, dash or underscore.`, 400);
  }
  if (!input.label.trim()) throw new ApiError("Enter a connection label.", 400);
  await requestJson("/api/v1/integrations", {
    method: "POST", label: "Create connection",
    body: {
      mode: "manage", action: "connection.create", confirm: true,
      user: input.user, provider: input.provider, connection: input.connection,
      label: input.label.trim(), authMethod: input.authMethod, makeDefault: input.makeDefault,
    },
  }, signal, fetcher, bridge);
}

export type ComposioKeyKind = "organization" | "user" | "project" | "connect" | null;
export type ComposioSession = { mcpUrl: string; expiresAt: number | null };

const KEY_KINDS = new Set<Exclude<ComposioKeyKind, null>>(["organization", "user", "project", "connect"]);

/** `ck_…` keys are Composio Connect: they validate at the Connect MCP endpoint, not Platform. */
export async function readComposioKeyKind(
  user: string, connection: string, signal: AbortSignal,
  fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<ComposioKeyKind> {
  const query = new URLSearchParams({ user, connection }).toString();
  const payload = await requestJson(`/api/v1/integrations/composio/session?${query}`, {
    method: "GET", label: "Composio session",
  }, signal, fetcher, bridge);
  if (!isRecord(payload)) throw new ApiError("The MSO Composio response is invalid.", 502);
  const kind = payload.keyKind;
  if (kind === null || kind === undefined) return null;
  if (!KEY_KINDS.has(kind as Exclude<ComposioKeyKind, null>)) {
    throw new ApiError("The MSO Composio response is invalid.", 502);
  }
  return kind as ComposioKeyKind;
}

export async function createComposioSession(
  user: string, connection: string, refresh: boolean, signal: AbortSignal,
  fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<ComposioSession> {
  const payload = await requestJson("/api/v1/integrations/composio/session", {
    method: "POST", label: "Composio session", timeoutMs: 30_000,
    body: { user, connection, ...(refresh ? { refresh: true } : {}) },
  }, signal, fetcher, bridge);
  if (!isRecord(payload) || typeof payload.mcpUrl !== "string") {
    throw new ApiError("The MSO Composio response is invalid.", 502);
  }
  let url: URL;
  try { url = new URL(payload.mcpUrl); } catch { throw new ApiError("The MSO Composio response is invalid.", 502); }
  if (url.protocol !== "https:" || !url.hostname.endsWith("composio.dev")) {
    throw new ApiError("The MSO Composio response is invalid.", 502);
  }
  return { mcpUrl: url.toString(), expiresAt: typeof payload.expiresAt === "number" ? payload.expiresAt : null };
}
