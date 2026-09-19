import { parseGraphCustomNodes } from "@/lib/contracts/graph-custom-nodes";
import { ORGANIZATION_FLOW_KINDS, ORGANIZATION_FLOW_STATUSES, type OrganizationFlowNode, type OrganizationFlowEdge, type OrganizationProjectFlow } from "@/lib/contracts/organization-flow";

export function flowRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("project flow value must be an object");
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, max: number, required = false): string {
  if (value === undefined) value = "";
  if (typeof value !== "string" || value.length > max) throw new Error(`${field} is invalid or exceeds ${max} characters`);
  if (required && !value.trim()) throw new Error(`${field} is required`);
  return value;
}
export function flowId(value: unknown): string {
  const id = text(value, "flow id", 128, true);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) throw new Error("flow id is invalid");
  return id;
}
export function parseFlowNode(value: unknown): OrganizationFlowNode {
  const row = flowRecord(value);
  const kind = row.kind ?? "project", status = row.status ?? "unconfirmed";
  if (!(ORGANIZATION_FLOW_KINDS as readonly unknown[]).includes(kind)) throw new Error("flow node kind is invalid");
  if (!(ORGANIZATION_FLOW_STATUSES as readonly unknown[]).includes(status)) throw new Error("flow node status is invalid");
  const position = flowRecord(row.position ?? { x: 0, y: 0 });
  for (const key of ["x", "y"]) if (typeof position[key] !== "number" || !Number.isFinite(position[key]) || Math.abs(position[key] as number) > 100000) throw new Error("flow node position is invalid");
  const projectRef = text(row.projectRef, "projectRef", 4096).trim();
  return {
    id: flowId(row.id), title: text(row.title, "node title", 120, true).trim(),
    kind: kind as OrganizationFlowNode["kind"], status: status as OrganizationFlowNode["status"],
    summary: text(row.summary, "node summary", 500), notes: text(row.notes, "node notes", 12000),
    ...(projectRef ? { projectRef } : {}), position: { x: position.x as number, y: position.y as number },
  };
}
export function parseFlowEdge(value: unknown): OrganizationFlowEdge {
  const row = flowRecord(value);
  const edge = { id: flowId(row.id), source: flowId(row.source), target: flowId(row.target), label: text(row.label, "edge label", 160) };
  if (edge.source === edge.target) throw new Error("flow edge cannot connect a node to itself");
  return edge;
}
export function parseOrganizationFlow(value: unknown): OrganizationProjectFlow {
  const row = flowRecord(value);
  if (row.version !== 1) throw new Error("project flow version is invalid");
  if (!Array.isArray(row.nodes) || row.nodes.length > 200 || !Array.isArray(row.edges) || row.edges.length > 400) throw new Error("project flow requires bounded nodes (200) and edges (400)");
  const nodes = row.nodes.map(parseFlowNode), edges = row.edges.map(parseFlowEdge);
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length || new Set(edges.map((edge) => edge.id)).size !== edges.length) throw new Error("project flow ids must be unique");
  if (edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target))) throw new Error("flow edge endpoint not found in this unit");
  return { version: 1, title: text(row.title, "flow title", 160, true).trim(), notes: text(row.notes, "flow notes", 64000), nodes, edges, ...(row.customNodes !== undefined ? { customNodes: parseGraphCustomNodes(row.customNodes, ids) } : {}) };
}
