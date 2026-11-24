import { ApiError, type AgentGroupMember, type AgentGroupView } from "./agent-group-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export type AgentGroupDraft = {
  id?: string;
  name: string;
  maxRounds: number;
  enabled: boolean;
  members: Array<{ name: string; profile: string }>;
};

const KNOWN_CODES: Record<string, string> = {
  owner_required: "Owner role is required to manage agent groups.",
  rate_limited: "Too many requests. Wait a moment and retry.",
  agent_group_not_found: "Agent group was not found.",
  agent_group_revision_changed: "This group changed on another device. Reload and retry.",
  invalid_group_data: "The group details are not valid.",
  invalid_group_members: "This group needs at least one named member with a profile.",
  invalid_group_prompt: "Enter a valid discussion topic.",
};

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function statusMessage(status: number, body?: unknown): string {
  const code = isRecord(body) && typeof body.error === "string" ? body.error : "";
  if (status === 401) return "Your session is unavailable. Sign in and retry.";
  if (status === 403) return KNOWN_CODES.owner_required;
  if (status === 404) return KNOWN_CODES.agent_group_not_found;
  if (status === 409) return KNOWN_CODES.agent_group_revision_changed;
  if (status === 429) return KNOWN_CODES.rate_limited;
  if (code && KNOWN_CODES[code]) return KNOWN_CODES[code];
  return `Agent group request failed (${status}).`;
}

async function postGroup(
  body: Record<string, unknown>, signal: AbortSignal, fetcher: typeof fetch, bridge: ShellBridge,
): Promise<unknown> {
  const response = await fetcher(resolveApiUrl("/api/v1/agent-groups", bridge), {
    method: "POST",
    credentials: bridge.apiBaseOrigin ? "include" : "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  let parsed: unknown;
  try { parsed = await response.json(); } catch {
    if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
    throw new ApiError("The MSO agent group response is invalid.", 502);
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status, parsed), response.status);
  return parsed;
}

export function emptyDraft(): AgentGroupDraft {
  return { name: "", maxRounds: 1, enabled: true, members: [{ name: "", profile: "" }] };
}

export function draftFrom(group: AgentGroupView): AgentGroupDraft {
  return {
    id: group.id, name: group.name, maxRounds: group.maxRounds, enabled: group.enabled,
    members: group.members.map((member) => ({ name: member.name, profile: member.profile })),
  };
}

export function validateDraft(draft: AgentGroupDraft): string | null {
  if (!draft.name.trim()) return "Enter a group name.";
  if (!Number.isInteger(draft.maxRounds) || draft.maxRounds < 1 || draft.maxRounds > 20) {
    return "Rounds must be a whole number between 1 and 20.";
  }
  const filled = draft.members.filter((member) => member.name.trim() || member.profile.trim());
  if (filled.length === 0) return "Add at least one agent to the group.";
  for (const member of filled) {
    if (!member.name.trim()) return "Every agent needs a display name.";
    if (!member.profile.trim()) return "Every agent needs a Hermes profile.";
  }
  return null;
}

function memberPayload(draft: AgentGroupDraft): AgentGroupMember[] {
  return draft.members
    .filter((member) => member.name.trim() && member.profile.trim())
    .map((member, index) => ({
      id: `m${index + 1}`,
      name: member.name.trim(),
      profile: member.profile.trim(),
    }));
}

export async function createAgentGroup(
  draft: AgentGroupDraft, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<AgentGroupView> {
  const problem = validateDraft(draft);
  if (problem) throw new ApiError(problem, 400);
  const data = {
    name: draft.name.trim(), maxRounds: draft.maxRounds, enabled: draft.enabled,
    members: memberPayload(draft),
  };
  return (await postGroup({ action: "create", data }, signal, fetcher, bridge)) as AgentGroupView;
}

export async function updateAgentGroup(
  draft: AgentGroupDraft, expectedRevision: number, signal: AbortSignal,
  fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<AgentGroupView> {
  const problem = validateDraft(draft);
  if (problem) throw new ApiError(problem, 400);
  if (!draft.id) throw new ApiError("Select a group before saving.", 400);
  const data = {
    name: draft.name.trim(), maxRounds: draft.maxRounds, enabled: draft.enabled,
    members: memberPayload(draft),
  };
  return (await postGroup(
    { action: "update", id: draft.id, expectedRevision, data }, signal, fetcher, bridge,
  )) as AgentGroupView;
}

export async function deleteAgentGroup(
  id: string, expectedRevision: number, signal: AbortSignal,
  fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<unknown> {
  const trimmed = id.trim();
  if (!trimmed) throw new ApiError("Select a group before deleting.", 400);
  return postGroup({ action: "delete", id: trimmed, expectedRevision }, signal, fetcher, bridge);
}
