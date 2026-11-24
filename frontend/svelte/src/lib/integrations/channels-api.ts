import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export { ApiError };
export type { ShellBridge };

export type ChannelProviderId = "telegram" | "discord";
export type ChannelCredentialOption = {
  user: string; userLabel: string; connection: string; label: string; state: string;
  provider: ChannelProviderId;
};
export type ChannelRecordView = {
  id: string; name: string; provider: ChannelProviderId; enabled: boolean;
  credentialUser: string; credentialConnection: string;
  defaultTarget: string | null; workflowId: string | null; agentGroupId: string | null;
  createdAt: string; updatedAt: string; lastActivityAt: string | null;
  lastCheck: { at: string; ok: boolean; detail: string } | null;
  connectionState: string | null; connectionError: string | null;
};
export type ChannelWorkflowOption = { id: string; name: string };
export type ChannelGroupOption = { id: string; name: string };
export type ChannelDraft = {
  name: string; provider: ChannelProviderId; credentialUser: string; credentialConnection: string;
  enabled: boolean; defaultTarget: string; workflowId: string; agentGroupId: string;
};
export type ChannelsWorkspace = {
  revision: number; channels: ChannelRecordView[];
  credentials: ChannelCredentialOption[];
  workflows: ChannelWorkflowOption[]; groups: ChannelGroupOption[];
};

const PROVIDERS = new Set<ChannelProviderId>(["telegram", "discord"]);
const ERROR_CODE = /^[a-z0-9_.:-]{1,64}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const optionalString = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

const MESSAGES: Record<string, string> = {
  channel_revision_changed: "Another device changed this channel. Reload and reapply your edit.",
  channel_not_found: "That channel no longer exists. Reload the list.",
  channel_target_required: "Set a default target before sending a test message.",
  channel_disabled: "Enable the channel before sending a message.",
  invalid_provider: "Choose Telegram or Discord.",
  credential_required: "Choose an Integration connection first.",
  secret_input_forbidden: "Channel records store references only. Enter bot tokens in Integrations.",
  invalid_agent_group: "Choose a valid agent group.",
  invalid_workflow: "Choose a valid inbound workflow.",
  rate_limited: "Too many channel actions. Wait a minute and retry.",
  channel_operation_failed: "The channel action failed. Check the connection and retry.",
};

export function channelsStatusMessage(status: number): string {
  if (status === 401) return "Your session is unavailable. Sign in and retry.";
  if (status === 403) return "Owner role is required to manage messaging channels.";
  if (status === 409) return MESSAGES.channel_revision_changed!;
  if (status === 429) return MESSAGES.rate_limited!;
  if (status === 502 || status === 503) return "The channels service is temporarily unavailable. Retry when ready.";
  return MESSAGES.channel_operation_failed!;
}

function codeMessage(body: unknown, status: number): string {
  const code = isRecord(body) && typeof body.error === "string" ? body.error : "";
  if (code && ERROR_CODE.test(code) && MESSAGES[code]) return MESSAGES[code];
  return channelsStatusMessage(status);
}

type ChannelRequest = { method: "GET" | "POST"; body?: unknown };

/** The single channel transport. A provider error code is mapped to operator copy here so
 *  no upstream string can reach the panel. */
export async function channelsJson(
  path: string, options: ChannelRequest, signal: AbortSignal, fetcher: typeof fetch, bridge: ShellBridge,
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetcher(resolveApiUrl(path, bridge), {
    method: options.method, credentials: bridge.apiBaseOrigin ? "include" : "same-origin", cache: "no-store",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]), headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(channelsStatusMessage(response.status), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new ApiError("The MSO channels response is invalid.", 502); }
  if (!response.ok) throw new ApiError(codeMessage(payload, response.status), response.status);
  return payload;
}

function parseChannel(raw: unknown): ChannelRecordView {
  if (!isRecord(raw) || !nonEmpty(raw.id) || !nonEmpty(raw.name) || !PROVIDERS.has(raw.provider as ChannelProviderId)) {
    throw new ApiError("The MSO channels response is invalid.", 502);
  }
  const credential = isRecord(raw.credential) ? raw.credential : null;
  if (!credential || !nonEmpty(credential.user) || !nonEmpty(credential.connection)) {
    throw new ApiError("The MSO channels response is invalid.", 502);
  }
  const connection = isRecord(raw.connection) ? raw.connection : null;
  const lastCheck = isRecord(raw.lastCheck) && nonEmpty(raw.lastCheck.at) && typeof raw.lastCheck.ok === "boolean"
    && typeof raw.lastCheck.detail === "string"
    ? { at: raw.lastCheck.at, ok: raw.lastCheck.ok, detail: raw.lastCheck.detail }
    : null;
  return {
    id: raw.id, name: raw.name, provider: raw.provider as ChannelProviderId,
    enabled: raw.enabled === true,
    credentialUser: credential.user, credentialConnection: credential.connection,
    defaultTarget: optionalString(raw.defaultTarget), workflowId: optionalString(raw.workflowId),
    agentGroupId: optionalString(raw.agentGroupId),
    createdAt: nonEmpty(raw.createdAt) ? raw.createdAt : "",
    updatedAt: nonEmpty(raw.updatedAt) ? raw.updatedAt : "",
    lastActivityAt: optionalString(raw.lastActivityAt),
    lastCheck,
    connectionState: connection && typeof connection.state === "string" ? connection.state : null,
    connectionError: connection && typeof connection.error === "string" ? connection.error : null,
  };
}

function parseCredentials(raw: unknown): ChannelCredentialOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (!isRecord(row) || !nonEmpty(row.user) || !nonEmpty(row.id)) return [];
    if (!PROVIDERS.has(row.provider as ChannelProviderId)) return [];
    return [{
      user: row.user, userLabel: nonEmpty(row.userLabel) ? row.userLabel : row.user,
      connection: row.id, label: nonEmpty(row.label) ? row.label : row.id,
      state: typeof row.state === "string" ? row.state : "",
      provider: row.provider as ChannelProviderId,
    }];
  });
}

async function readOptional<T>(path: string, pick: (payload: unknown) => T | null, signal: AbortSignal,
  fetcher: typeof fetch, bridge: ShellBridge): Promise<T | null> {
  try {
    return pick(await channelsJson(path, { method: "GET" }, signal, fetcher, bridge));
  } catch { return null; }
}

/** One read for the whole Channels workspace: channel records, bot credentials and the
 *  two reference lists the editor binds to. Reference lists degrade to empty, never block. */
export async function readChannelsWorkspace(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<ChannelsWorkspace> {
  const payload = await channelsJson("/api/v1/channels", { method: "GET" }, signal, fetcher, bridge);
  if (!isRecord(payload) || payload.version !== 1 || !Number.isInteger(payload.revision) || !Array.isArray(payload.channels)) {
    throw new ApiError("The MSO channels response is invalid.", 502);
  }
  const [workflows, groups] = await Promise.all([
    readOptional("/api/v1/workflows", (body) => {
      if (!isRecord(body) || !Array.isArray(body.graphs)) return null;
      return body.graphs.flatMap((graph) => {
        if (!isRecord(graph) || !nonEmpty(graph.id) || !nonEmpty(graph.name)) return [];
        if (graph.status !== "active") return [];
        const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
        if (!nodes.some((node) => isRecord(node) && node.type === "channel_trigger")) return [];
        return [{ id: graph.id, name: graph.name }];
      });
    }, signal, fetcher, bridge),
    readOptional("/api/v1/agent-groups", (body) => {
      if (!isRecord(body) || !Array.isArray(body.groups)) return null;
      return body.groups.flatMap((group) => (isRecord(group) && nonEmpty(group.id) && nonEmpty(group.name)
        ? [{ id: group.id, name: group.name }] : []));
    }, signal, fetcher, bridge),
  ]);
  return {
    revision: payload.revision as number,
    channels: payload.channels.map(parseChannel),
    credentials: parseCredentials(payload.credentials),
    workflows: workflows ?? [],
    groups: groups ?? [],
  };
}
