import { SESSION_GRAPH_EVENT_LIMIT } from "@/lib/contracts/session-monitor";
import type { SessionCard, SessionGraphView } from "@/lib/contracts/session-monitor";
import type { WorkflowGraph, WorkflowGraphNode } from "@/lib/contracts/workflow-graph";
import { redactText } from "@/lib/security/redact-text";
import type { AgentSession, AgentSessionEvent } from "./session-types";

function text(value: string | undefined, max = 500): string | undefined {
  return value ? redactText(value, max).replace(/[\u0000-\u001f\u007f]/g, " ") : undefined;
}

function safeEvent(row: AgentSessionEvent) {
  return {
    at: row.at,
    kind: text(row.kind, 40) || "note",
    tool: text(row.tool, 100),
    state: text(row.state, 60),
    detail: text(row.detail, 1000),
    workflowId: text(row.workflowId, 100),
  };
}

function nodeName(event: ReturnType<typeof safeEvent>): string {
  return (event.tool || event.kind || "event")
    .replace(/[_.:-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .slice(0, 120);
}

function nodeType(event: ReturnType<typeof safeEvent>): WorkflowGraphNode["type"] {
  if (event.kind === "workflow") return "subflow";
  if (["note", "compacted", "archived"].includes(event.kind)) return "memory";
  return "tool";
}

export function sessionGraph(
  record: AgentSession,
  session: SessionCard,
  requestedLimit = SESSION_GRAPH_EVENT_LIMIT,
): SessionGraphView {
  const limit = Math.max(
    1,
    Math.min(SESSION_GRAPH_EVENT_LIMIT, Math.trunc(requestedLimit) || SESSION_GRAPH_EVENT_LIMIT),
  );
  const totalEvents = record.events.length;
  const omittedEvents = Math.max(0, totalEvents - limit);
  const events = record.events.slice(-limit).map(safeEvent);
  const root: WorkflowGraphNode = {
    id: "session-root",
    name: session.label,
    type: "session",
    position: { x: 70, y: 100 },
    config: {
      label: session.label,
      source: session.source,
      status: session.status,
      title: session.title,
      ...(session.cwd ? { cwd: session.cwd } : {}),
    },
  };
  const eventNodes: WorkflowGraphNode[] = events.map((event, index) => {
    const row = Math.floor(index / 4);
    const column = index % 4;
    const displayColumn = row % 2 === 0 ? column : 3 - column;
    return {
      id: `event-${omittedEvents + index + 1}`,
      name: nodeName(event),
      type: nodeType(event),
      position: { x: 340 + displayColumn * 250, y: 70 + row * 140 },
      config: {
        at: event.at,
        kind: event.kind,
        ...(event.tool ? { tool: event.tool } : {}),
        ...(event.state ? { state: event.state } : {}),
        ...(event.detail ? { detail: event.detail } : {}),
        terminalContext: Boolean(event.tool && /^(exec(?:_|\.)|terminal|shell)/i.test(event.tool)),
      },
    };
  });
  const nodes = [root, ...eventNodes];
  const edges = eventNodes.map((node, index) => ({
    id: `session-edge-${omittedEvents + index + 1}`,
    source: index === 0 ? root.id : eventNodes[index - 1]!.id,
    target: node.id,
  }));
  const graph: WorkflowGraph = {
    version: 2,
    id: `session:${record.id}`,
    name: session.label,
    description: session.title,
    status: "archived",
    inputs: {},
    nodes,
    edges,
    metadata: {
      provenance: "learned-from-session",
      intent: session.title,
      ...(session.cwd ? { project: session.cwd } : {}),
      tags: ["session", session.source],
    },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revision: `session-${Date.parse(record.updatedAt) || 0}`,
  };
  return {
    session,
    graph,
    totalEvents,
    shownEvents: events.length,
    omittedEvents,
    observedAt: new Date().toISOString(),
  };
}
