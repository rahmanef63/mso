import { liveSessionAuthorized } from "@/lib/auth/live-authorization";
import type { SessionPayload } from "@/lib/auth/session";
import { prepareSelectedModel } from "@/lib/ai/selected-model-stream";
import { PROFILE_READ_TOOLS, type AgentProfile, type AgentProfileRunResult } from "@/lib/contracts/agent-profile";
import type { CapabilityRuntime } from "@/lib/capabilities/runtime";
import type { CapabilityRunContext } from "@/lib/capabilities/tool";
import { createAgentSession, updateAgentSessionHistory, appendAgentSessionEvent } from "./session-store";
import { AgentProfileError, profileFields, profileObject, profilePrincipal, profileRevision, profileText } from "./profile-schema";
import { requireAgentProfile } from "./profile-store";
import { runBoundedAgent } from "./bounded-runner";
import { runAcpAgentProfile } from "./acp-runtime";
import type { AcpInstance } from "./acp-drivers";
import { intEnv } from "./session-policy";

export function profileRuntimeAuthority(session: SessionPayload, profile: AgentProfile, capabilities: CapabilityRuntime, options: { signal?: AbortSignal; sessionId?: string } = {}) {
  if (!session.device_id) throw new AgentProfileError("profile_owner_unsupported", 403);
  const principal = profilePrincipal(`web:${session.device_id}`), id = profile.id, revision = profile.revision;
  if (profile.owner !== principal) throw new AgentProfileError("profile_not_found", 404);
  const allowedTools = [...profile.config.tools];
  const liveAuthorization = async () => {
    options.signal?.throwIfAborted();
    if (!await liveSessionAuthorized(session, "owner")) throw new AgentProfileError("profile_owner_session_revoked", 403);
    await requireAgentProfile(principal, id, revision);
    options.signal?.throwIfAborted();
  };
  const listed = () => capabilities.list("read").filter(tool => tool.scope === "read" && (PROFILE_READ_TOOLS as readonly string[]).includes(tool.name) && allowedTools.includes(tool.name));
  const runtime: CapabilityRuntime = {
    list: listed,
    async invoke(input) {
      await liveAuthorization();
      if (!listed().some(tool => tool.name === input.name)) throw new AgentProfileError("profile_tool_denied", 403);
      const result = await capabilities.invoke({ name: input.name, args: input.args ?? {}, principal, actor: principal, scope: "read",
        allowedTools, sessionId: options.sessionId, signal: options.signal, liveAuthorization });
      await liveAuthorization();
      return result;
    },
  };
  const context: CapabilityRunContext = { principal, actor: principal, scope: "read", allowedTools, capabilities: runtime,
    signal: options.signal, sessionId: options.sessionId, liveAuthorization };
  return { runtime, context, liveAuthorization };
}

export async function runAgentProfile(input: { session: SessionPayload; body: unknown; capabilities: CapabilityRuntime; signal: AbortSignal; resolveAcpInstance?: (driver: string) => AcpInstance | undefined }): Promise<AgentProfileRunResult> {
  if (!input.session.device_id) throw new AgentProfileError("profile_owner_unsupported", 403);
  const body = profileObject(input.body); profileFields(body, ["profileId", "profileRevision", "prompt"]);
  const principal = profilePrincipal(`web:${input.session.device_id}`), revision = profileRevision(body.profileRevision);
  const prompt = profileText(body.prompt, "prompt", 8000);
  const id = body.profileId === undefined ? undefined : profileText(body.profileId, "id", 80);
  input.signal.throwIfAborted();
  if (!await liveSessionAuthorized(input.session, "owner")) throw new AgentProfileError("profile_owner_session_revoked", 403);
  const profile = await requireAgentProfile(principal, id, revision);
  // `acp-cli` hands the turn to an installed agent CLI and owns its own, longer bound.
  // The `mso-readonly` path below keeps its unchanged 60s bound.
  if (profile.config.runtime === "acp-cli") {
    const authority = profileRuntimeAuthority(input.session, profile, input.capabilities, { signal: input.signal });
    return runAcpAgentProfile({ profile, prompt, principal, signal: input.signal, liveAuthorization: authority.liveAuthorization,
      ...(input.resolveAcpInstance ? { resolveInstance: input.resolveAcpInstance } : {}) });
  }
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(new AgentProfileError("profile_run_timeout", 504)), 60_000);
  const signal = AbortSignal.any([input.signal, controller.signal]);
  let runId: string | undefined;
  try {
    const initial = profileRuntimeAuthority(input.session, profile, input.capabilities, { signal });
    await initial.liveAuthorization();
    const prepared = await prepareSelectedModel(profile.config.model);
    await initial.liveAuthorization();
    const run = await createAgentSession(principal, "alfa", { title: profile.config.name, titleSource: "manual",
      memorySnapshot: { capturedAt: new Date().toISOString(), user: "", memory: "", schemaVersion: 1, recordCount: 0 } });
    runId = run.id;
    const authority = profileRuntimeAuthority(input.session, profile, input.capabilities, { signal, sessionId: runId });
    const result = await runBoundedAgent({ prepared, objective: prompt,
      system: `You are MSO saved profile ${profile.config.name}. Work on the requested read task. Only the saved read tools may run. Do not claim to change files or run commands. No earlier chat or owner memory is included.\n${profile.config.instructions}`,
      capabilities: authority.runtime, authority: authority.context, actor: principal,
      tools: context => authority.runtime.list(context.scope, context),
      maxTurns: intEnv("OS_AGENT_PROFILE_MAX_TURNS", 6, 1, 10_000),
      maxToolCalls: intEnv("OS_AGENT_PROFILE_MAX_TOOL_CALLS", 16, 1, 100_000), signal });
    await updateAgentSessionHistory(principal, runId, result.messages);
    await appendAgentSessionEvent(principal, runId, { kind: "note", state: result.status, detail: `Profile ${profile.id}, revision ${profile.revision}` });
    await authority.liveAuthorization();
    signal.throwIfAborted();
    return { runId, profileId: profile.id, profileRevision: profile.revision, model: profile.config.model,
      status: result.status, text: result.text, rounds: result.rounds, toolCalls: result.toolCalls };
  } catch (error) {
    if (runId) await appendAgentSessionEvent(principal, runId, { kind: "note", state: "failed", detail: `Profile ${profile.id}, revision ${profile.revision}; task stopped` }).catch(() => undefined);
    throw controller.signal.aborted ? controller.signal.reason : error;
  } finally { clearTimeout(timeout); }
}
