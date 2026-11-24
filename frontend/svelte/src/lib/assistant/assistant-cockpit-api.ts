import { ApiError } from "../host-api.ts";
import { detectShellBridge, type ShellBridge } from "../shell-bridge.ts";
import {
  deleteThreadRecord,
  fetchJsonSafe,
  isDemoStub,
  isRecord,
  listThreads,
  loadThreadById,
  renameThreadRecord,
  saveThreadRecord,
} from "./assistant-threads-api.ts";
import type {
  AgentProfileRunOutput,
  AgentProfileSummary,
  AgentSessionSummary,
  AgentToolInfo,
  CockpitSnapshot,
  EndpointStatus,
} from "./assistant-types.ts";

export { deleteThreadRecord, listThreads, loadThreadById, renameThreadRecord, saveThreadRecord };

const PROFILE_RUN_TIMEOUT_MS = 65_000;

export async function listAgentProfiles(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<{ profiles: AgentProfileSummary[]; defaultProfileId: string | null; status: EndpointStatus; note: string | null }> {
  const res = await fetchJsonSafe("GET", "/api/v1/agent-profiles", signal, fetcher, bridge);
  if (!res.ok) return { profiles: [], defaultProfileId: null, status: res.status, note: res.note };
  if (isDemoStub(res.data)) return { profiles: [], defaultProfileId: null, status: "offline", note: "Saved profiles require a live owner host." };
  if (!isRecord(res.data) || !isRecord(res.data.store) || !Array.isArray(res.data.store.profiles)) {
    return { profiles: [], defaultProfileId: null, status: "offline", note: "Profiles catalog unavailable." };
  }
  const defaultId = typeof res.data.store.defaultProfileId === "string" ? res.data.store.defaultProfileId : null;
  const profiles: AgentProfileSummary[] = [];
  for (const row of res.data.store.profiles) {
    if (!isRecord(row) || typeof row.id !== "string" || !isRecord(row.config)) continue;
    const cfg = row.config;
    const modelRec = isRecord(cfg.model) ? cfg.model : {};
    profiles.push({
      id: row.id,
      revision: typeof row.revision === "number" ? row.revision : 1,
      enabled: row.enabled !== false,
      isDefault: row.id === defaultId,
      name: typeof cfg.name === "string" && cfg.name.trim() ? cfg.name.trim() : row.id,
      avatar: typeof cfg.avatar === "string" ? cfg.avatar : "",
      instructions: typeof cfg.instructions === "string" ? cfg.instructions : "",
      runtime: typeof cfg.runtime === "string" ? cfg.runtime : "mso-readonly",
      model: {
        provider: typeof modelRec.provider === "string" ? modelRec.provider : "",
        model: typeof modelRec.model === "string" ? modelRec.model : "",
      },
      tools: Array.isArray(cfg.tools) ? cfg.tools.filter((t): t is string => typeof t === "string") : [],
    });
  }
  return { profiles, defaultProfileId: defaultId, status: "ready", note: null };
}

export async function runSavedProfile(
  input: { profileId: string; profileRevision: number; prompt: string },
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<AgentProfileRunOutput> {
  const res = await fetchJsonSafe("POST", "/api/v1/agent-profiles/run", signal, fetcher, bridge, input, PROFILE_RUN_TIMEOUT_MS);
  if (!res.ok) throw new ApiError(res.note, res.httpStatus || 502);
  if (!isRecord(res.data) || typeof res.data.text !== "string") {
    throw new ApiError("Agent profile run returned an invalid response.", 502);
  }
  const calls = Array.isArray(res.data.toolCalls)
    ? res.data.toolCalls
        .filter((c): c is Record<string, unknown> => isRecord(c) && typeof c.name === "string")
        .map((c) => ({ name: String(c.name), ok: c.ok !== false }))
    : [];
  return {
    runId: typeof res.data.runId === "string" ? res.data.runId : `run-${Date.now()}`,
    profileId: typeof res.data.profileId === "string" ? res.data.profileId : input.profileId,
    profileRevision: typeof res.data.profileRevision === "number" ? res.data.profileRevision : input.profileRevision,
    status: res.data.status === "partial" ? "partial" : "completed",
    text: res.data.text,
    rounds: typeof res.data.rounds === "number" ? res.data.rounds : 1,
    toolCalls: calls,
  };
}

export async function listAgentTools(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<{ scope: string; tools: AgentToolInfo[]; status: EndpointStatus; note: string | null }> {
  const res = await fetchJsonSafe("GET", "/api/v1/agent-tools", signal, fetcher, bridge);
  if (!res.ok) return { scope: "", tools: [], status: res.status, note: res.note };
  if (isDemoStub(res.data)) return { scope: "demo", tools: [], status: "offline", note: "Host tool inventory requires a live owner host." };
  if (!isRecord(res.data) || !Array.isArray(res.data.tools)) return { scope: "", tools: [], status: "offline", note: "Tools catalog unavailable." };
  const tools: AgentToolInfo[] = [];
  for (const row of res.data.tools) {
    if (!isRecord(row) || typeof row.name !== "string" || !row.name.trim()) continue;
    tools.push({
      name: row.name.trim(),
      description: typeof row.description === "string" ? row.description : "",
      scope: typeof row.scope === "string" ? row.scope : "read",
      approvalRequired: row.approvalRequired === true,
    });
  }
  return { scope: typeof res.data.scope === "string" ? res.data.scope : "read", tools, status: "ready", note: null };
}

export async function listAgentSessions(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(), limit = 20,
): Promise<{ sessions: AgentSessionSummary[]; status: EndpointStatus; note: string | null }> {
  const res = await fetchJsonSafe("GET", `/api/v1/agent-sessions?limit=${limit}`, signal, fetcher, bridge);
  if (!res.ok) return { sessions: [], status: res.status, note: res.note };
  if (isDemoStub(res.data)) return { sessions: [], status: "offline", note: "Agent sessions require a live owner host." };
  if (!isRecord(res.data) || !Array.isArray(res.data.sessions)) return { sessions: [], status: "offline", note: "Sessions list unavailable." };
  const sessions: AgentSessionSummary[] = [];
  for (const row of res.data.sessions) {
    if (!isRecord(row) || typeof row.id !== "string") continue;
    sessions.push({
      id: row.id,
      ...(typeof row.name === "string" ? { name: row.name } : {}),
      ...(typeof row.source === "string" ? { source: row.source } : {}),
      ...(typeof row.title === "string" ? { title: row.title } : {}),
      ...(typeof row.updatedAt === "string" || typeof row.updatedAt === "number" ? { updatedAt: row.updatedAt } : {}),
      ...(typeof row.cwd === "string" ? { cwd: row.cwd } : {}),
      ...(typeof row.estimatedTokens === "number" ? { estimatedTokens: row.estimatedTokens } : {}),
      ...(typeof row.eventCount === "number" ? { eventCount: row.eventCount } : {}),
    });
  }
  return { sessions, status: "ready", note: null };
}

export async function readCockpitSnapshot(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<{ snapshot: CockpitSnapshot | null; status: EndpointStatus }> {
  const res = await fetchJsonSafe("GET", "/api/v1/alfa/cockpit", signal, fetcher, bridge);
  if (!res.ok || isDemoStub(res.data) || !isRecord(res.data)) return { snapshot: null, status: res.ok ? "offline" : res.status };
  const modelRec = isRecord(res.data.model) ? res.data.model : null;
  const projectsRec = isRecord(res.data.projects) ? res.data.projects : null;
  const sessions = Array.isArray(res.data.sessions) ? res.data.sessions : [];
  const agents = Array.isArray(res.data.localAgents) ? res.data.localAgents : [];
  return {
    status: "ready",
    snapshot: {
      ...(modelRec && typeof modelRec.model === "string"
        ? {
            model: {
              provider: typeof modelRec.provider === "string" ? modelRec.provider : "",
              model: modelRec.model,
              ...(typeof modelRec.tokenSaver === "string" ? { tokenSaver: modelRec.tokenSaver } : {}),
            },
          }
        : {}),
      projectCount: typeof projectsRec?.total === "number" ? projectsRec.total : 0,
      localAgentCount: agents.length,
      legacyMemoryCount: typeof res.data.legacyMemoryCount === "number" ? res.data.legacyMemoryCount : 0,
      activeSessions: sessions.length,
    },
  };
}
