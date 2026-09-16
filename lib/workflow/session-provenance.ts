import type { AgentSession } from "@/lib/agent/session-types";
import { sessionFlowActions } from "@/lib/agent/session-flow";
import type { WorkflowStep, WorkflowStepProvenance } from "./types";

/**
 * Correlate already-sanitized workflow steps with same-session tool receipts.
 * Matching is ordered and conservative: a provenance link is emitted only when
 * workflow id + tool (+ compatible state when present) agree.
 */
export function workflowStepProvenance(
  session: AgentSession,
  workflowId: string,
  sessionLabel: string,
  steps: WorkflowStep[],
  evidenceRef?: string,
): Record<string, WorkflowStepProvenance> {
  const actions = sessionFlowActions(session.events, session.cwd, session.eventSeqBase);
  const candidates = session.events.map((event, index) => ({ event, action: actions[index] }))
    .filter((row) => row.event.workflowId === workflowId && row.action?.tool);
  const out: Record<string, WorkflowStepProvenance> = {};
  let cursor = 0;
  for (const step of steps) {
    let match = -1;
    for (let index = cursor; index < candidates.length; index += 1) {
      const row = candidates[index]!;
      if (row.action!.tool !== step.tool) continue;
      if (row.action!.state && row.action!.state !== step.state) continue;
      match = index; break;
    }
    if (match < 0) continue;
    const action = candidates[match]!.action!;
    cursor = match + 1;
    out[step.id] = {
      sessionLabel: sessionLabel.slice(0, 180), actionRef: action.ref, eventRef: action.eventRef, observedAt: action.at,
      ...(action.artifact ? { artifactRefs: [action.artifact.ref] } : {}),
      ...(evidenceRef && /^evidence_[a-f0-9]{20}$/.test(evidenceRef) ? { evidenceRef } : {}),
    };
  }
  return out;
}
