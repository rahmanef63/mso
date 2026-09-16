import { createHash } from "node:crypto";
import type { WorkflowGraphDefinition } from "@/lib/workflow/graph-schema";
import { semanticSessionFlow } from "./session-flow";
import { agentSessionLabel } from "./session-name";
import type { AgentSession } from "./session-types";

function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function safeNodeId(value: string, index: number): string {
  return `learned-${value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "action"}-${index + 1}`;
}

/**
 * Create an inert, review-first workflow definition from the bounded semantic
 * session projection. Learned tool nodes are disabled and contain no captured
 * arguments, command payloads, transcripts, or internal session ids.
 */
export function sessionWorkflowDraftDefinition(record: AgentSession, stepRef?: string): WorkflowGraphDefinition {
  const label = agentSessionLabel(record.name, record.title, record.cwd);
  const flow = semanticSessionFlow(record.events, 120, record.cwd, record.eventSeqBase);
  const steps = stepRef ? flow.steps.filter((step) => step.ref.toUpperCase() === stepRef.trim().toUpperCase()) : flow.steps;
  if (stepRef && !steps.length) throw new Error(`session semantic step not found: ${stepRef.toUpperCase()}`);
  if (!steps.length) throw new Error("session has no semantic actions to save");
  const actions = steps.flatMap((step) => step.actions).filter((action) => action.tool).slice(0, 120);
  if (!actions.length) throw new Error("session selection has no reusable tool actions");
  const learned = actions.map((action, index) => ({
    id: safeNodeId(action.ref, index),
    name: `${action.ref} · ${action.tool}`.slice(0, 120),
    type: "tool" as const,
    position: { x: 300 + (index % 4) * 260, y: 120 + Math.floor(index / 4) * 150 },
    disabled: true,
    config: {
      tool: action.tool!,
      arguments: {},
      sourceRef: action.ref,
      sourceEventRef: action.eventRef,
      sourceCategory: action.category,
      ...(action.artifact ? { sourceArtifactRefs: [action.artifact.ref] } : {}),
      reviewRequired: true,
    },
  }));
  const manual = { id: "manual", name: "Manual Trigger", type: "manual" as const, position: { x: 40, y: 120 }, config: {} };
  const output = { id: "output", name: "Output", type: "output" as const, position: { x: 300 + (learned.length % 4) * 260, y: 120 + Math.floor(learned.length / 4) * 150 }, config: {} };
  const nodes = [manual, ...learned, output];
  const edges = nodes.slice(1).map((node, index) => ({ id: `edge-${index + 1}`, source: nodes[index]!.id, target: node.id }));
  const selectedRefs = steps.map((step) => step.ref);
  const sourceDigest = digest(JSON.stringify({ label, refs: actions.map((action) => [action.ref, action.eventRef, action.tool]), updatedAt: record.updatedAt }));
  return {
    name: `${stepRef ? `${stepRef.toUpperCase()} · ` : ""}${record.title}`.slice(0, 160),
    description: `Review-first draft from ${stepRef ? `semantic step ${stepRef.toUpperCase()}` : "the visible semantic session flow"}. Learned actions are disabled until inputs are reviewed.`,
    status: "draft",
    inputs: {},
    nodes,
    edges,
    metadata: {
      intent: record.title,
      ...(record.cwd ? { project: record.cwd } : {}),
      provenance: "learned-from-session",
      fingerprint: digest(`session-draft\0${sourceDigest}`),
      sourceDigests: [sourceDigest],
      tags: ["session-draft", ...(stepRef ? ["semantic-step", stepRef.toUpperCase()] : ["semantic-session"]), ...selectedRefs.slice(0, 8)],
    },
  };
}
