import { SESSION_GRAPH_EVENT_LIMIT } from "@/lib/contracts/session-monitor";
import type { SessionCard, SessionGraphView } from "@/lib/contracts/session-monitor";
import type { WorkflowGraph, WorkflowGraphNode } from "@/lib/contracts/workflow-graph";
import type { AgentSession } from "./session-types";
import { semanticSessionFlow } from "./session-flow";

export function sessionGraph(record: AgentSession, session: SessionCard, requestedLimit = SESSION_GRAPH_EVENT_LIMIT): SessionGraphView {
  const flow = semanticSessionFlow(record.events, requestedLimit, session.cwd);
  const root: WorkflowGraphNode = {
    id: "session-root", name: session.label, type: "session", position: { x: 60, y: 90 },
    config: { sessionRoot: true, label: session.label, source: session.source, status: session.status, title: session.title, ...(session.cwd ? { cwd: session.cwd } : {}), stepCount: flow.steps.length },
  };
  const stepNodes: WorkflowGraphNode[] = flow.steps.map((step, index) => {
    const slot = index + 1, row = Math.floor(slot / 3), column = slot % 3, displayColumn = row % 2 === 0 ? column : 2 - column;
    return { id: `step-${index + 1}`, name: `${step.ref} · ${step.title}`, type: "subflow", position: { x: 60 + displayColumn * 310, y: 90 + row * 180 },
      config: { sessionStep: true, ref: step.ref, category: step.category, summary: step.summary, actionCount: step.actions.length, startedAt: step.startedAt, finishedAt: step.finishedAt } };
  });
  const nodes = [root, ...stepNodes];
  const edges = stepNodes.map((node, index) => ({ id: `session-step-edge-${index + 1}`, source: index === 0 ? root.id : stepNodes[index - 1]!.id, target: node.id }));
  const graph: WorkflowGraph = {
    version: 2, id: `session:${record.id}`, name: session.label, description: session.title, status: "archived", inputs: {}, nodes, edges,
    metadata: { provenance: "learned-from-session", intent: session.title, ...(session.cwd ? { project: session.cwd } : {}), tags: ["session", "semantic-flow", session.source] },
    createdAt: record.createdAt, updatedAt: record.updatedAt, revision: `session-${Date.parse(record.updatedAt) || 0}`,
  };
  return { session, graph, steps: flow.steps, totalEvents: flow.totalEvents, shownEvents: flow.shownEvents, omittedEvents: flow.omittedEvents, observedAt: new Date().toISOString() };
}
