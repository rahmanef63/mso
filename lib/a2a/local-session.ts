import { randomUUID } from "node:crypto";
import {
  agentSessionSummary,
  createAgentSession,
} from "@/lib/agent/session-store";
import {
  ownerSessionSummaries,
  resolveAgentSessionOwnerRef,
  resolveAgentSessionRef,
} from "@/lib/agent/session-query";
import type { AgentSession } from "@/lib/agent/session-types";
import type { CapabilityRuntime } from "@/lib/capabilities/runtime";
import { a2aLoopbackOrigin } from "./network";
import { executeInboundA2ATask } from "./server-execution";
import { createA2ATask, taskPublicView } from "./tasks";
import type { A2AAuthenticatedProfile } from "./server-protocol";

const LOCAL_PROFILE: A2AAuthenticatedProfile = {
  id: "local-loopback",
  label: "local-loopback",
  scope: "exec",
  createdAt: "local",
  updatedAt: "local",
  local: true,
};

function cardUrlForSession(id: string): string {
  const url = new URL(`${a2aLoopbackOrigin()}/.well-known/agent-card.json`);
  url.searchParams.set("session", id);
  return url.toString();
}

export async function listA2ALocalSessions(limit = 100) {
  return (await ownerSessionSummaries(limit)).map((session) => ({
    ...session,
    cardUrl: cardUrlForSession(session.id),
  }));
}

export async function resolveA2ALocalSession(
  ref: string,
): Promise<AgentSession> {
  return resolveAgentSessionOwnerRef(ref);
}

async function runLocalSessionTask(session: AgentSession, objective: string, capabilities: CapabilityRuntime) {
  const prompt = String(objective || "").trim();
  if (!prompt) throw new Error("A2A local objective is required");
  const principal = `a2a:local:${session.id}`;
  const task = await createA2ATask(
    principal,
    "exec",
    {
      messageId: `local_${randomUUID()}`,
      role: "ROLE_USER",
      parts: [{ text: prompt, mediaType: "text/plain" }],
    },
    session.id,
  );
  const completed = await executeInboundA2ATask(
    task,
    LOCAL_PROFILE,
    prompt,
    session,
    capabilities,
  );
  return taskPublicView(completed);
}

export async function handoffA2ALocalSession(ref: string, objective: string, capabilities: CapabilityRuntime) {
  const session = await resolveA2ALocalSession(ref);
  return {
    session: agentSessionSummary(session),
    task: await runLocalSessionTask(session, objective, capabilities),
  };
}

/** Execute against a same-owner durable session without requiring its terminal
 * process to be present. This is a fresh bounded agent run, never a TTY wake. */
export async function handoffOwnerLocalSession(principal: string, ref: string, objective: string, capabilities: CapabilityRuntime, currentSessionId?: string) {
  const session = await resolveAgentSessionRef(principal, ref);
  if (session.id === currentSessionId) throw new Error("cannot run a local agent request against the same session");
  return {
    session: agentSessionSummary(session),
    task: await runLocalSessionTask(session, objective, capabilities),
  };
}

export async function spawnA2ALocalSubagent(input: {
  ownerPrincipal: string;
  sourceSessionRef: string;
  objective: string;
  title?: string;
  capabilities: CapabilityRuntime;
}) {
  const source = await resolveA2ALocalSession(input.sourceSessionRef);
  const title =
    String(input.title || "")
      .trim()
      .slice(0, 120) || `Subagent · ${source.title}`;
  const child = await createAgentSession(input.ownerPrincipal, "cli", {
    title,
    titleSource: "auto",
    parentSessionId: source.id,
    cwd: source.cwd,
    memorySnapshot: source.memorySnapshot,
    contextSummary: source.contextSummary,
    history: source.history.slice(-24),
  });
  return {
    session: agentSessionSummary(child),
    task: await runLocalSessionTask(child, input.objective, input.capabilities),
  };
}
