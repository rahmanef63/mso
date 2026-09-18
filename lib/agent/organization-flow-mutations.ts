import { pruneGraphCustomNodes } from "@/lib/contracts/graph-custom-nodes";
import { randomUUID } from "node:crypto";
import { emptyOrganizationFlow, type OrganizationFlowAction, type OrganizationProjectFlow } from "@/lib/contracts/organization-flow";
import { flowId, flowRecord, parseFlowEdge, parseFlowNode, parseOrganizationFlow } from "./organization-flow-schema";

/** Pure, unit-local edits. Never resolves a runtime or executes graph content. */
export function changeOrganizationFlow(current: OrganizationProjectFlow | undefined, action: OrganizationFlowAction, data: Record<string, unknown>): OrganizationProjectFlow {
  const flow = structuredClone(current ?? emptyOrganizationFlow());
  switch (action) {
    case "flow_custom_nodes": { if (!Array.isArray(data.customNodes)) throw new Error("customNodes array is required"); return parseOrganizationFlow({ ...flow, customNodes: data.customNodes }); }
    case "flow_nodes_move": {
      if (!Array.isArray(data.positions) || data.positions.length < 1 || data.positions.length > 200) throw new Error("positions requires 1-200 nodes");
      const moved = new Set<string>();
      for (const value of data.positions) {
        const row = flowRecord(value), id = flowId(row.id), index = flow.nodes.findIndex((node) => node.id === id);
        if (index < 0 || moved.has(id)) throw new Error("move node missing or duplicated");
        moved.add(id); flow.nodes[index] = parseFlowNode({ ...flow.nodes[index], position: row.position });
      }
      break;
    }
    case "flow_replace": return parseOrganizationFlow(data.flow);
    case "flow_update": return parseOrganizationFlow({ ...flow, ...("title" in data ? { title: data.title } : {}), ...("notes" in data ? { notes: data.notes } : {}) });
    case "flow_node_upsert": {
      const raw = flowRecord(data.node);
      const id = raw.id === undefined ? `node_${randomUUID()}` : flowId(raw.id);
      const node = parseFlowNode({ ...flow.nodes.find((item) => item.id === id), ...raw, id });
      const index = flow.nodes.findIndex((item) => item.id === id);
      if (index < 0) flow.nodes.push(node); else flow.nodes[index] = node;
      break;
    }
    case "flow_node_delete": {
      const id = flowId(data.id);
      if (!flow.nodes.some((node) => node.id === id)) throw new Error("flow node not found in this unit");
      flow.nodes = flow.nodes.filter((node) => node.id !== id);
      if (flow.customNodes) flow.customNodes = pruneGraphCustomNodes(flow.customNodes, new Set(flow.nodes.map((node) => node.id)));
      flow.edges = flow.edges.filter((edge) => edge.source !== id && edge.target !== id);
      break;
    }
    case "flow_edge_upsert": {
      const raw = flowRecord(data.edge);
      const id = raw.id === undefined ? `edge_${randomUUID()}` : flowId(raw.id);
      const edge = parseFlowEdge({ ...flow.edges.find((item) => item.id === id), ...raw, id });
      const index = flow.edges.findIndex((item) => item.id === id);
      if (index < 0) flow.edges.push(edge); else flow.edges[index] = edge;
      break;
    }
    case "flow_edge_delete": {
      const id = flowId(data.id);
      if (!flow.edges.some((edge) => edge.id === id)) throw new Error("flow edge not found in this unit");
      flow.edges = flow.edges.filter((edge) => edge.id !== id);
      break;
    }
    default: throw new Error("unsupported project flow action");
  }
  return parseOrganizationFlow(flow);
}
