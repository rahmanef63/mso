import { deleteOrganizationSeat, deleteOrganizationUnit, getOrganizationChart, replaceOrganization, upsertOrganizationSeat, upsertOrganizationUnit } from "@/lib/agent/organization-store";
import { organizationRuntime, resolveOrganizationSeat } from "@/lib/agent/organization-runtime";
import { type McpTool, S, str } from "./tool-kit";

export const ORGANIZATION_TOOLS: McpTool[] = [
  {
    name: "organization_chart", title: "Organization Chart", scope: "read",
    description: "Read the private MSO organization hierarchy: units, reporting seats, execution bindings and live target status. This is organization/context metadata, not a workflow definition and never contains credentials.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }, limit: { key: "organization.read", max: 60, windowMs: 60_000 },
    chatgptDescription: "Read private organization units, seats, reporting lines and target status.",
    inputSchema: S({ seat: { type: "string" }, runtime: { type: "boolean" } }),
    run: async (a, context) => {
      const chart = await getOrganizationChart(), runtime = a.runtime === false ? [] : await organizationRuntime(context.principal);
      if (typeof a.seat === "string" && a.seat.trim()) return { chart: { name: chart.name, revision: chart.revision }, seat: await resolveOrganizationSeat(a.seat), runtime };
      return { chart, runtime };
    },
  },
  {
    name: "organization_manage", title: "Manage Organization", scope: "write",
    description: "Create/update/delete organization units and seats with optimistic revision checks. Seat targets reference existing project agents, local sessions, or A2A peers; no credentials or hidden context are copied.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }, audit: { action: "agent.organization", targetArg: "action" }, limit: { key: "organization.write", max: 30, windowMs: 60_000 },
    chatgptDescription: "Mutate organization units/seats using the current revision.",
    inputSchema: S({ action: { type: "string" }, expected_revision: { type: "string" }, id: { type: "string" }, data: { type: "object" } }, ["action", "expected_revision"]),
    run: async (a) => {
      const action = str(a, "action"), revision = str(a, "expected_revision"), data = a.data && typeof a.data === "object" && !Array.isArray(a.data) ? a.data as Record<string, unknown> : {};
      if (action === "unit_upsert") return { chart: await upsertOrganizationUnit(revision, data) };
      if (action === "seat_upsert") return { chart: await upsertOrganizationSeat(revision, data) };
      if (action === "unit_delete") return { chart: await deleteOrganizationUnit(revision, str(a, "id")) };
      if (action === "seat_delete") return { chart: await deleteOrganizationSeat(revision, str(a, "id")) };
      if (action === "replace") return { chart: await replaceOrganization(revision, data as never) };
      throw new Error("unsupported organization action");
    },
  },
];
