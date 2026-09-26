import { getAgentSession, listAgentSessions, resumeAgentSession } from "@/lib/agent/session-store";
import type { AgentSession } from "@/lib/agent/session-types";
import { resolveAgentSessionContinuation, resolveAgentSessionRef } from "@/lib/agent/session-query";
import { agentSessionLabel } from "@/lib/agent/session-name";
import { resolveProjectHint } from "@/lib/host/projects-api";
import { workflowRecoveryCandidates, type WorkflowRecoveryCandidate } from "@/lib/workflow";
import { type McpTool, S } from "./tool-kit";

function requiredPrincipal(context: { principal?: string }): string {
  if (!context.principal) throw new Error("agent session principal is unavailable");
  return context.principal;
}

function optionalString(a: Record<string, unknown>, key: string): string | undefined {
  const value = a[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function continuationPayload(recovery?: WorkflowRecoveryCandidate) {
  if (!recovery) {
    return {
      source: "session" as const,
      instruction: "Use the resume packet and semantic session flow as evidence. Start a fresh workflow before new mutations.",
    };
  }
  return {
    source: "unfinished_workflow" as const,
    workflow: {
      intent: recovery.intent,
      ...(recovery.project ? { project: recovery.project } : {}),
      ...(recovery.constraints ? { constraints: recovery.constraints } : {}),
      startedAt: recovery.startedAt,
      lastActivityAt: recovery.lastActivityAt,
      stepCount: recovery.stepCount,
      recentSteps: recovery.recentSteps,
    },
    workflowStart: {
      intent: recovery.intent,
      ...(recovery.project ? { project: recovery.project } : {}),
      ...(recovery.constraints ? { constraints: recovery.constraints } : {}),
    },
    instruction: "This is a crash-recovery checkpoint. Do not reuse the old workflow_id; call workflow_start with workflowStart, validate live state, then continue.",
  };
}

export const AGENT_SESSION_RESUME_TOOL: McpTool = {
  name: "agent_session_resume",
  description: "Recover prior work without requiring a session id. Pass session_ref for an exact session, or omit it and optionally pass project to auto-select the newest relevant prior session/unfinished workflow. Returns safe recent context plus a fresh-workflow continuation recipe; never ChatGPT hidden transcript.",
  scope: "read",
  annotations: { readOnlyHint: true, idempotentHint: true },
  inputSchema: S({
    session_ref: { type: "string", description: "Optional human session label (agent-context), @name, title, latest/continue, or legacy exact id. Omit for crash-safe auto recovery." },
    session_id: { type: "string", description: "Legacy exact MSO session id; prefer session_ref or auto recovery." },
    project: { type: "string", description: "Optional project id/path/name/alias used to select the newest relevant unfinished workflow/session automatically." },
  }),
  run: async (a, context) => {
    const owner = requiredPrincipal(context);
    const ref = optionalString(a, "session_ref") || optionalString(a, "session_id");
    const projectHint = optionalString(a, "project");
    const resolvedProject = projectHint ? await resolveProjectHint(projectHint).catch(() => null) : null;
    const projectRefs = [resolvedProject?.path, resolvedProject?.id, resolvedProject?.name, projectHint]
      .filter((value): value is string => Boolean(value));

    let recovery: WorkflowRecoveryCandidate | undefined;
    let target: AgentSession;
    if (ref) {
      target = await resolveAgentSessionRef(owner, ref);
      recovery = (await workflowRecoveryCandidates({
        principal: owner,
        projectRefs,
        excludeSessionId: context.sessionId,
        limit: 20,
      })).find((row) => row.sourceSessionId === target.id);
    } else {
      const unfinished = await workflowRecoveryCandidates({
        principal: owner,
        projectRefs,
        excludeSessionId: context.sessionId,
        limit: 20,
      });
      if (!projectRefs.length && unfinished.length > 1) {
        const candidates = (await Promise.all(unfinished.slice(0, 8).map(async (row) => {
          const session = await getAgentSession(owner, row.sourceSessionId);
          if (!session) return null;
          return {
            sessionRef: agentSessionLabel(session.name, session.title, session.cwd),
            title: session.title,
            intent: row.intent,
            ...(row.project ? { project: row.project } : {}),
            lastActivityAt: row.lastActivityAt,
            stepCount: row.stepCount,
          };
        }))).filter((row): row is NonNullable<typeof row> => Boolean(row));
        return {
          selectionRequired: true,
          candidates,
          instruction: "Several unfinished workflows are recoverable. Choose the candidate that matches the user's request and call agent_session_resume again with its sessionRef or project. Do not ask the user to search MSO for an id.",
        };
      }

      recovery = unfinished[0];
      if (!recovery && !projectRefs.length) {
        const priorSessions = (await listAgentSessions(owner, 20))
          .filter((session) => session.id !== context.sessionId);
        if (priorSessions.length > 1) {
          return {
            selectionRequired: true,
            candidates: priorSessions.slice(0, 8).map((session) => ({
              sessionRef: session.label,
              title: session.title,
              updatedAt: session.updatedAt,
              ...(session.cwd ? { project: session.cwd } : {}),
            })),
            instruction: "Several durable sessions are recoverable. Choose the candidate that matches the user's request and call agent_session_resume again with its sessionRef. Do not ask the user to search MSO for an id.",
          };
        }
        if (!priorSessions.length) throw new Error("session_not_found");
        const onlyTarget = await getAgentSession(owner, priorSessions[0]!.id);
        if (!onlyTarget) throw new Error("session_not_found");
        target = onlyTarget;
      } else {
        const recoveredTarget = recovery
          ? await getAgentSession(owner, recovery.sourceSessionId)
          : await resolveAgentSessionContinuation(owner, {
              excludeSessionId: context.sessionId,
              projectRefs,
            });
        if (!recoveredTarget) throw new Error("session_not_found");
        target = recoveredTarget;
      }
    }

    const packet = await resumeAgentSession(owner, target.id, context.sessionId);
    return { ...packet, continuation: continuationPayload(recovery) };
  },
};
