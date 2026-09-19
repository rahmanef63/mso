import { ORGANIZATION_FLOW_ACTIONS, isOrganizationFlowAction } from "@/lib/contracts/organization-flow";
import { deleteOrganizationSeat, deleteOrganizationUnit, mutateOrganizationFlow, getOrganizationChart, replaceOrganization, upsertOrganizationSeat, upsertOrganizationUnit } from "@/lib/agent/organization-store";
import { organizationRuntime, resolveOrganizationSeat } from "@/lib/agent/organization-runtime";
import { type McpTool, S, str } from "./tool-kit";

export const ORGANIZATION_TOOLS: McpTool[] = [
  {
    name: "organization_chart", title: "Organization Chart", scope: "read",
    description: "Read the private MSO organization hierarchy: units, reporting seats, execution bindings and live target status. Each unit may include an internal projectFlow (nodes, edges, notes). These are context maps, not executable workflows.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }, limit: { key: "organization.read", max: 60, windowMs: 60_000 },
    chatgptDescription: "Read organization units, internal projectFlow nodes/edges/notes, seats and target status.",
    inputSchema: S({ seat: { type: "string" }, runtime: { type: "boolean" } }),
    run: async (a, context) => {
      const chart = await getOrganizationChart(), runtime = a.runtime === false ? [] : await organizationRuntime(context.principal);
      if (typeof a.seat === "string" && a.seat.trim()) return { chart: { name: chart.name, revision: chart.revision }, seat: await resolveOrganizationSeat(a.seat), runtime };
      return { chart, runtime };
    },
  },
  {
    name: "organization_manage", title: "Manage Organization", scope: "write",
    description: "Create/update/delete organization units and seats with optimistic revision checks. Seat targets reference existing project agents, local sessions, or A2A peers; no credentials or hidden context are copied. Custom grouping: flow_custom_nodes (data.unitId,customNodes=[{id,name,nodeIds,collapsed}]); flow_nodes_move (data.unitId,positions=[{id,position:{x,y}}]). Members and execution identities are preserved. Internal project flow actions: flow_update (data.unitId,title?,notes?), flow_replace (data.unitId,flow), flow_node_upsert (data.unitId,node), flow_node_delete (data.unitId,id), flow_edge_upsert (data.unitId,edge), flow_edge_delete (data.unitId,id). Node fields: id?,title,kind=project|activity|group|note,status=unconfirmed|planned|active|blocked|done,summary,notes,position={x,y},projectRef?. Edge fields: id?,source,target,label. Node deletion removes its incident edges. No action executes graph content.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }, audit: { action: "agent.organization", targetArg: "action" }, limit: { key: "organization.write", max: 30, windowMs: 60_000 },
    chatgptDescription: "Edit units/seats or internal project flows. flow_* actions require data.unitId and current revision.",
    inputSchema: S({ action: { type: "string", enum: ["unit_upsert", "seat_upsert", "unit_delete", "seat_delete", "replace", ...ORGANIZATION_FLOW_ACTIONS] }, expected_revision: { type: "string" }, id: { type: "string" }, data: { type: "object", description: "For flow_* actions: unitId is required; flow_custom_nodes uses customNodes=[{id,name,nodeIds,collapsed}], flow_nodes_move uses positions=[{id,position:{x,y}}]; flow_update uses title/notes; flow_replace uses flow={version:1,title,notes,nodes,edges}; flow_node_upsert uses node={id?,title,kind?,status?,summary?,notes?,position?:{x,y},projectRef?}; flow_edge_upsert uses edge={id?,source,target,label?}; deletes use id. Existing node/edge id permits partial update." } }, ["action", "expected_revision"]),
    run: async (a, context) => {
      const action = str(a, "action"), revision = str(a, "expected_revision"), data = a.data && typeof a.data === "object" && !Array.isArray(a.data) ? a.data as Record<string, unknown> : {};
      if (action === "unit_upsert") return { chart: await upsertOrganizationUnit(revision, data) };
      if (action === "seat_upsert") return { chart: await upsertOrganizationSeat(revision, data) };
      if (action === "unit_delete") return { chart: await deleteOrganizationUnit(revision, str(a, "id")) };
      if (action === "seat_delete") return { chart: await deleteOrganizationSeat(revision, str(a, "id")) };
      if (isOrganizationFlowAction(action)) return { chart: await mutateOrganizationFlow(revision, action, data, { principal: context.principal }) };
      if (action === "replace") return { chart: await replaceOrganization(revision, data as never) };
      throw new Error("unsupported organization action");
    },
  },
];
