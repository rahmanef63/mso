import { ApiError } from "../host-api.ts";
import { detectShellBridge, type ShellBridge } from "../shell-bridge.ts";
import { channelsJson, channelsStatusMessage, type ChannelDraft, type ChannelProviderId } from "./channels-api.ts";

export type ChannelTestOutcome = { ok: boolean; detail: string; checkedAt: string | null };
export type ChannelSendOutcome = { target: string };
export type { ChannelDraft, ChannelProviderId };

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function channelBody(draft: ChannelDraft): Record<string, unknown> {
  return {
    name: draft.name.trim(),
    provider: draft.provider,
    credential: { user: draft.credentialUser, connection: draft.credentialConnection },
    enabled: draft.enabled,
    defaultTarget: draft.defaultTarget.trim(),
    workflowId: draft.workflowId,
    agentGroupId: draft.agentGroupId,
  };
}

function assertDraft(draft: ChannelDraft): void {
  if (!draft.name.trim()) throw new ApiError("Enter a channel name.", 400);
  if (!draft.credentialUser || !draft.credentialConnection) {
    throw new ApiError("Choose an Integration connection first.", 400);
  }
}

export async function createChannel(
  draft: ChannelDraft, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<void> {
  assertDraft(draft);
  await channelsJson("/api/v1/channels", { method: "POST", body: { action: "create", data: channelBody(draft) } },
    signal, fetcher, bridge);
}

export async function updateChannel(
  id: string, expectedRevision: number, draft: ChannelDraft,
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<void> {
  if (!id) throw new ApiError("That channel no longer exists. Reload the list.", 404);
  assertDraft(draft);
  await channelsJson("/api/v1/channels", {
    method: "POST", body: { action: "update", id, expectedRevision, data: channelBody(draft) },
  }, signal, fetcher, bridge);
}

export async function setChannelEnabled(
  id: string, expectedRevision: number, enabled: boolean,
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<void> {
  await channelsJson("/api/v1/channels", {
    method: "POST", body: { action: "update", id, expectedRevision, data: { enabled } },
  }, signal, fetcher, bridge);
}

export async function deleteChannel(
  id: string, expectedRevision: number, signal: AbortSignal,
  fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<void> {
  await channelsJson("/api/v1/channels", {
    method: "POST", body: { action: "delete", id, expectedRevision },
  }, signal, fetcher, bridge);
}

export async function testChannelConnection(
  id: string, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<ChannelTestOutcome> {
  const payload = await channelsJson("/api/v1/channels", { method: "POST", body: { action: "test", id } },
    signal, fetcher, bridge);
  if (!isRecord(payload) || typeof payload.ok !== "boolean" || typeof payload.detail !== "string") {
    throw new ApiError("The MSO channel test response is invalid.", 502);
  }
  const channel = isRecord(payload.channel) && isRecord(payload.channel.lastCheck) ? payload.channel.lastCheck : null;
  return {
    ok: payload.ok, detail: payload.detail,
    checkedAt: channel && nonEmpty(channel.at) ? channel.at : null,
  };
}

export async function sendChannelMessage(
  id: string, target: string, text: string, signal: AbortSignal,
  fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<ChannelSendOutcome> {
  const body = text.trim();
  if (!body) throw new ApiError("Enter a message to send.", 400);
  const payload = await channelsJson("/api/v1/channels", {
    method: "POST", body: { action: "send", id, text: body, ...(target.trim() ? { target: target.trim() } : {}) },
  }, signal, fetcher, bridge);
  if (!isRecord(payload)) throw new ApiError("The MSO channel send response is invalid.", 502);
  return { target: nonEmpty(payload.target) ? payload.target : target.trim() };
}

export { channelsStatusMessage };
