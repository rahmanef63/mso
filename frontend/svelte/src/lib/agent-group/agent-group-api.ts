import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export { ApiError };
export type { ShellBridge };

export type AgentGroupMemberTelegram = { user: string; connection: string; target: string };
export type AgentGroupMember = { id: string; name: string; profile: string; telegram?: AgentGroupMemberTelegram };
export type AgentGroupTurn = {
  round: number; memberId: string; name: string; profile: string; text: string; at: string; error?: string;
};
export type AgentGroupRunState = "running" | "completed" | "failed" | "stopped";
export type AgentGroupRun = {
  id: string; groupId: string; prompt: string; turns: AgentGroupTurn[];
  state: AgentGroupRunState; error?: string; startedAt: string; updatedAt: string;
};
export type AgentGroupView = {
  id: string; name: string; members: AgentGroupMember[]; maxRounds: number;
  enabled: boolean; createdAt: string; updatedAt: string; runs: AgentGroupRun[];
};
export type AgentGroupsSnapshot = { groups: AgentGroupView[]; revision: number };
export type AgentGroupViewState =
  | { kind: "loading" }
  | { kind: "ready"; snapshot: AgentGroupsSnapshot; busyAction: "run" | "stop" | null; notice?: string; actionError?: string }
  | { kind: "error"; message: string; forbidden?: boolean };

const RUN_STATES = new Set<AgentGroupRunState>(["running", "completed", "failed", "stopped"]);
const KNOWN_CODES: Record<string, string> = {
  owner_required: "Owner role is required to manage agent groups.",
  rate_limited: "Too many requests. Wait a moment and retry.",
  agent_group_not_found: "Agent group was not found.",
  agent_group_run_not_found: "Agent group run was not found.",
  agent_group_disabled: "This agent group is disabled.",
  invalid_group_prompt: "Enter a valid discussion prompt.",
  invalid_group_members: "This group has no valid members selected.",
};
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isOptStr = (v: unknown): v is string | undefined => v === undefined || typeof v === "string";
const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;
const invalid = () => new ApiError("The MSO agent group response is invalid.", 502);

function statusMessage(status: number, body?: unknown): string {
  const code = isRecord(body) && typeof body.error === "string" ? body.error : "";
  if (status === 401) return "Your session is unavailable. Sign in and retry.";
  if (status === 403) return KNOWN_CODES.owner_required;
  if (status === 429) return KNOWN_CODES.rate_limited;
  if (status === 502 || status === 503) return "Agent group service is temporarily unavailable. Retry when ready.";
  if (code && KNOWN_CODES[code]) return KNOWN_CODES[code];
  return `Agent group request failed (${status}).`;
}

function validateMember(raw: unknown): AgentGroupMember {
  if (!isRecord(raw) || !isNonEmpty(raw.id) || !isNonEmpty(raw.name) || !isNonEmpty(raw.profile)) throw invalid();
  let telegram: AgentGroupMemberTelegram | undefined;
  if (raw.telegram !== undefined) {
    if (!isRecord(raw.telegram) || !isNonEmpty(raw.telegram.user)
        || !isNonEmpty(raw.telegram.connection) || !isNonEmpty(raw.telegram.target)) throw invalid();
    telegram = { user: raw.telegram.user, connection: raw.telegram.connection, target: raw.telegram.target };
  }
  return { id: raw.id, name: raw.name, profile: raw.profile, ...(telegram ? { telegram } : {}) };
}

function validateTurn(raw: unknown): AgentGroupTurn {
  if (!isRecord(raw) || !isPosInt(raw.round) || !isNonEmpty(raw.memberId) || !isNonEmpty(raw.name)
      || !isNonEmpty(raw.profile) || typeof raw.text !== "string" || !isNonEmpty(raw.at) || !isOptStr(raw.error)) throw invalid();
  return {
    round: raw.round, memberId: raw.memberId, name: raw.name, profile: raw.profile,
    text: raw.text, at: raw.at, ...(raw.error ? { error: raw.error } : {}),
  };
}

function validateRun(raw: unknown): AgentGroupRun {
  if (!isRecord(raw) || !isNonEmpty(raw.id) || !isNonEmpty(raw.groupId) || typeof raw.prompt !== "string"
      || !Array.isArray(raw.turns) || !RUN_STATES.has(raw.state as AgentGroupRunState)
      || !isOptStr(raw.error) || !isNonEmpty(raw.startedAt) || !isNonEmpty(raw.updatedAt)) throw invalid();
  return {
    id: raw.id, groupId: raw.groupId, prompt: raw.prompt, turns: raw.turns.map(validateTurn),
    state: raw.state as AgentGroupRunState, startedAt: raw.startedAt, updatedAt: raw.updatedAt,
    ...(raw.error ? { error: raw.error } : {}),
  };
}

function validateGroup(raw: unknown): AgentGroupView {
  if (!isRecord(raw) || !isNonEmpty(raw.id) || !isNonEmpty(raw.name) || !Array.isArray(raw.members)
      || !isPosInt(raw.maxRounds) || typeof raw.enabled !== "boolean"
      || !isNonEmpty(raw.createdAt) || !isNonEmpty(raw.updatedAt) || !Array.isArray(raw.runs)) throw invalid();
  return {
    id: raw.id, name: raw.name, members: raw.members.map(validateMember), maxRounds: raw.maxRounds,
    enabled: raw.enabled, createdAt: raw.createdAt, updatedAt: raw.updatedAt, runs: raw.runs.map(validateRun),
  };
}

function validateSnapshot(payload: unknown): AgentGroupsSnapshot {
  if (!isRecord(payload) || !Array.isArray(payload.groups)
      || typeof payload.revision !== "number" || !Number.isSafeInteger(payload.revision) || payload.revision < 0) throw invalid();
  return { groups: payload.groups.map(validateGroup), revision: payload.revision };
}

async function requestGroupsJson(
  method: "GET" | "POST", signal: AbortSignal, fetcher: typeof fetch, bridge: ShellBridge, body?: Record<string, unknown>,
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) };
  const response = await fetcher(resolveApiUrl("/api/v1/agent-groups", bridge), {
    method, credentials: bridge.apiBaseOrigin ? "include" : "same-origin", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  let parsed: unknown;
  try { parsed = await response.json(); } catch {
    if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
    throw invalid();
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status, parsed), response.status);
  return parsed;
}

export async function readAgentGroups(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<AgentGroupsSnapshot> {
  return validateSnapshot(await requestGroupsJson("GET", signal, fetcher, bridge));
}

export async function startGroupRun(
  id: string, prompt: string, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<AgentGroupRun> {
  const groupId = id.trim(); const text = prompt.trim();
  if (!groupId) throw new ApiError("Select an agent group before starting a run.", 400);
  if (!text) throw new ApiError("Enter a discussion prompt before starting a run.", 400);
  return validateRun(await requestGroupsJson("POST", signal, fetcher, bridge, { action: "run", id: groupId, prompt: text }));
}

export async function stopGroupRun(
  runId: string, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<AgentGroupRun> {
  const trimmed = runId.trim();
  if (!trimmed) throw new ApiError("Select an active run to stop.", 400);
  return validateRun(await requestGroupsJson("POST", signal, fetcher, bridge, { action: "stop", runId: trimmed }));
}

function mergeRun(snapshot: AgentGroupsSnapshot, run: AgentGroupRun): AgentGroupsSnapshot {
  return {
    ...snapshot,
    groups: snapshot.groups.map((g) => g.id !== run.groupId ? g : { ...g, runs: [run, ...g.runs.filter((r) => r.id !== run.id)] }),
  };
}

export function createAgentGroupController(
  update: (next: AgentGroupViewState) => void, fetcher = fetch, bridge?: ShellBridge,
) {
  let generation = 0; let active: AbortController | undefined; let disposed = false;
  let current: AgentGroupsSnapshot | null = null;

  function fail(error: unknown, fallback: string, keepReady: boolean) {
    const forbidden = error instanceof ApiError && error.status === 403;
    const authLost = error instanceof ApiError && (error.status === 401 || error.status === 403);
    const message = error instanceof ApiError ? error.message : fallback;
    if (keepReady && current && !authLost) update({ kind: "ready", snapshot: current, busyAction: null, actionError: message });
    else { current = null; update({ kind: "error", message, ...(forbidden ? { forbidden: true } : {}) }); }
  }

  async function runAction<T>(
    prep: () => boolean, exec: (signal: AbortSignal) => Promise<T>, onOk: (res: T) => void, fallback: string, keepReady: boolean,
  ) {
    if (disposed || !prep()) return;
    const run = ++generation; active?.abort();
    const controller = (active = new AbortController());
    try {
      const result = await exec(controller.signal);
      if (!disposed && run === generation) onOk(result);
    } catch (error) {
      if (!disposed && run === generation && !controller.signal.aborted) fail(error, fallback, keepReady);
    }
  }

  return {
    refresh() {
      return runAction(
        () => { update({ kind: "loading" }); return true; },
        (sig) => readAgentGroups(sig, fetcher, bridge),
        (snapshot) => { current = snapshot; update({ kind: "ready", snapshot, busyAction: null }); },
        "Could not load agent groups. Check the backend and retry.", false,
      );
    },
    startRun(id: string, prompt: string) {
      return runAction(
        () => { if (!current) return false; update({ kind: "ready", snapshot: current, busyAction: "run" }); return true; },
        (sig) => startGroupRun(id, prompt, sig, fetcher, bridge),
        (created) => { if (!current) return; current = mergeRun(current, created); update({ kind: "ready", snapshot: current, busyAction: null, notice: "Agent group run started." }); },
        "Could not start agent group run. Check the backend and retry.", true,
      );
    },
    stopRun(runId: string) {
      return runAction(
        () => { if (!current) return false; update({ kind: "ready", snapshot: current, busyAction: "stop" }); return true; },
        (sig) => stopGroupRun(runId, sig, fetcher, bridge),
        (stopped) => { if (!current) return; current = mergeRun(current, stopped); update({ kind: "ready", snapshot: current, busyAction: null, notice: "Agent group run stopped." }); },
        "Could not stop agent group run. Check the backend and retry.", true,
      );
    },
    dispose() { disposed = true; generation++; active?.abort(); },
  };
}
