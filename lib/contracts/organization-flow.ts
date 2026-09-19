import type { GraphCustomNode } from "./graph-custom-nodes";
/** Organization context graph, not an executable automation workflow. */
export const ORGANIZATION_FLOW_KINDS = ["project", "activity", "group", "note"] as const;
export const ORGANIZATION_FLOW_STATUSES = ["unconfirmed", "planned", "active", "blocked", "done"] as const;
export const ORGANIZATION_FLOW_ACTIONS = ["flow_custom_nodes", "flow_nodes_move", "flow_update", "flow_replace", "flow_node_upsert", "flow_node_delete", "flow_edge_upsert", "flow_edge_delete"] as const;
export type OrganizationFlowAction = typeof ORGANIZATION_FLOW_ACTIONS[number];
export type OrganizationFlowNode = {
  id: string;
  title: string;
  kind: typeof ORGANIZATION_FLOW_KINDS[number];
  status: typeof ORGANIZATION_FLOW_STATUSES[number];
  summary: string;
  notes: string;
  /** Optional reference only. This never grants execution authority. */
  projectRef?: string;
  position: { x: number; y: number };
};
export type OrganizationFlowEdge = { id: string; source: string; target: string; label: string };
export type OrganizationProjectFlow = {
  customNodes?: GraphCustomNode[];
  version: 1;
  title: string;
  notes: string;
  nodes: OrganizationFlowNode[];
  edges: OrganizationFlowEdge[];
};
export const emptyOrganizationFlow = (): OrganizationProjectFlow => ({ version: 1, title: "Project flow", notes: "", nodes: [], edges: [] });
export const isOrganizationFlowAction = (action: string): action is OrganizationFlowAction => (ORGANIZATION_FLOW_ACTIONS as readonly string[]).includes(action);
