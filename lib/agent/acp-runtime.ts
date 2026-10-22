import type { AgentProfile, AgentProfileRunResult } from "@/lib/contracts/agent-profile";
import { type AcpPermissionPolicy, type AcpPermissionRequest, type AcpSessionUpdate } from "./acp-client";
import { createAcpInstance, type AcpInstance } from "./acp-drivers";
import { AgentProfileError } from "./profile-schema";
import { appendAgentSessionEvent, createAgentSession, updateAgentSessionHistory } from "./session-store";

// Bridge from a saved profile to an INSTALLED agent CLI over ACP.
//
// Additive by design: `mso-readonly` keeps its own 60s bound and its own result path in
// profile-runtime.ts. An ACP turn legitimately runs far longer — the CLI owns a whole
// model + tool loop — so its ceiling is stated here, per runtime, and is NEVER derived
// from the old 60s one.
export const ACP_PROFILE_RUN_TIMEOUT_MS = 10 * 60_000;

/** ACP stop reasons mapped honestly: only a clean end of turn is `completed`. */
export function acpRunStatus(stopReason: string): "completed" | "partial" {
  return stopReason === "end_turn" ? "completed" : "partial";
}

export interface AcpProfileRunInput {
  profile: AgentProfile;
  prompt: string;
  /** Server-derived owner principal, never a client value. */
  principal: string;
  signal: AbortSignal;
  /** The existing authority chain: owner grant + saved revision re-read. */
  liveAuthorization: () => Promise<void>;
  /** Optional narrow allow policy. Without one the agent's requests are all denied. */
  permissionPolicy?: AcpPermissionPolicy;
  cwd?: string;
  /** Test seam: production spawns one isolated instance per run. */
  resolveInstance?: (driver: string) => AcpInstance | undefined;
}

/**
 * What one turn observed. Everything here comes from `session/update` the agent really
 * sent: nothing is assumed about tool names, and a call the agent never reported as
 * `completed` is not a success.
 */
interface TurnTape {
  text: string;
  denied: boolean;
  calls: Map<string, { name: string; status: string }>;
}

function tape(update: AcpSessionUpdate, state: TurnTape): void {
  if (update.kind === "agent_message") state.text += update.text;
  else if (update.kind === "tool_call") state.calls.set(update.toolCallId, { name: update.name, status: update.status });
  else if (update.kind === "tool_call_update") {
    const previous = state.calls.get(update.toolCallId);
    state.calls.set(update.toolCallId, { name: update.name ?? previous?.name ?? update.toolCallId,
      status: update.status ?? previous?.status ?? "pending" });
  }
}

/** Denial is recorded, not inferred: every unapproved permission is a partial turn. */
function recordingPolicy(state: TurnTape, policy?: AcpPermissionPolicy): AcpPermissionPolicy {
  return async (request: AcpPermissionRequest) => {
    const allow = policy ? (await policy(request)) === true : false;
    if (!allow) state.denied = true;
    return allow;
  };
}

export async function runAcpAgentProfile(input: AcpProfileRunInput): Promise<AgentProfileRunResult> {
  const { profile } = input, ref = profile.config.acp;
  if (profile.config.runtime !== "acp-cli" || !ref) throw new AgentProfileError("profile_runtime_unsupported", 422);
  await input.liveAuthorization();
  const run = await createAgentSession(input.principal, "alfa", { title: profile.config.name, titleSource: "manual",
    memorySnapshot: { capturedAt: new Date().toISOString(), user: "", memory: "", schemaVersion: 1, recordCount: 0 } });
  const controller = new AbortController(), state: TurnTape = { text: "", denied: false, calls: new Map() };
  const signal = AbortSignal.any([input.signal, controller.signal]);
  // Per-runtime ceiling; abort kills the child's whole process group, not just the turn.
  const timer = setTimeout(() => controller.abort(new AgentProfileError("profile_run_timeout", 504)), ACP_PROFILE_RUN_TIMEOUT_MS);
  const injected = input.resolveInstance?.(ref.driver);
  const instance = injected ?? createAcpInstance(ref.driver, { cwd: input.cwd ?? process.cwd(), signal });
  // A run owns its own sink and its own gate, even on a shared instance: without an
  // explicit allow policy the gate denies, so nothing is ever implicitly approved.
  // ponytail: a turn swaps the shared client's sink/gate in place; fine because
  // production gives every run its own instance. Add per-turn sessions if a shared
  // instance ever needs concurrent turns.
  instance.client.onUpdate = update => tape(update, state);
  instance.client.permissionPolicy = recordingPolicy(state, input.permissionPolicy);
  try {
    await instance.initialize();
    await input.liveAuthorization();
    const sessionId = await instance.openSession({ cwd: input.cwd ?? process.cwd() });
    await input.liveAuthorization();
    const stopReason = await instance.client.prompt(sessionId, promptText(profile, input.prompt));
    await input.liveAuthorization();
    signal.throwIfAborted();
    const status = state.denied ? "partial" : acpRunStatus(stopReason);
    const toolCalls = [...state.calls.values()].map(call => ({ name: call.name, ok: call.status === "completed" }));
    await updateAgentSessionHistory(input.principal, run.id, history(input.prompt, state.text));
    await appendAgentSessionEvent(input.principal, run.id, { kind: "note", state: status, detail: `Profile ${profile.id}, revision ${profile.revision}; ACP ${ref.driver} ${stopReason}` });
    await input.liveAuthorization();
    signal.throwIfAborted();
    return { runId: run.id, profileId: profile.id, profileRevision: profile.revision, model: profile.config.model,
      status, text: state.text, rounds: 1, toolCalls };
  } catch (error) {
    await appendAgentSessionEvent(input.principal, run.id, { kind: "note", state: "failed",
      detail: `Profile ${profile.id}, revision ${profile.revision}; task stopped` }).catch(() => undefined);
    throw controller.signal.aborted ? controller.signal.reason : error;
  } finally {
    clearTimeout(timer);
    if (!injected) instance.dispose();
  }
}

function promptText(profile: AgentProfile, prompt: string): string {
  const instructions = profile.config.instructions.trim();
  return instructions ? `${instructions}\n\n${prompt}` : prompt;
}

function history(prompt: string, text: string) {
  return [{ role: "user", text: prompt }, { role: "assistant", text }];
}
