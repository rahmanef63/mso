import type { Provenance } from "./types";

export type AttributionRow = {
  /** MCP capability tool name, or a `route:` pseudo-tool for a direct HTTP route. */
  tool: string;
  slice: string;
  evidence: Provenance;
};

export const ATTRIBUTION: readonly AttributionRow[] = [
  { tool: "workflow_graph", slice: "workflows", evidence: { kind: "cited", file: "lib/mcp/tools-flows.ts", line: 71, note: "workflow_graph is the capability form of the workflows module's own graph store" } },
  { tool: "flow_run", slice: "workflows", evidence: { kind: "cited", file: "lib/mcp/tools-flows.ts", line: 43, note: "flow_run drives the same workflow/flows domain the module edits" } },
  { tool: "flow_status", slice: "workflows", evidence: { kind: "cited", file: "lib/mcp/tools-flows.ts", line: 43, note: "flow_status polls the run the module started" } },
  { tool: "flow_manage", slice: "workflows", evidence: { kind: "cited", file: "lib/mcp/tools-flows.ts", line: 57, note: "flow_manage edits the module's own automation records" } },
  { tool: "organization_chart", slice: "organization", evidence: { kind: "cited", file: "lib/mcp/tools-organization.ts", line: 10, note: "organization_chart reads the same chart the module renders" } },
  { tool: "organization_manage", slice: "organization", evidence: { kind: "cited", file: "lib/mcp/tools-organization.ts", line: 22, note: "organization_manage mutates the same chart the module edits" } },
  { tool: "project_agent_vault_read", slice: "agent-vault", evidence: { kind: "cited", file: "lib/mcp/tools-agent-vault.ts", line: 9, note: "project_agent_vault_read is the capability form of the vault the module shows" } },
  { tool: "project_agent_vault_sync", slice: "agent-vault", evidence: { kind: "cited", file: "lib/mcp/tools-agent-vault.ts", line: 19, note: "project_agent_vault_sync performs the same vault sync the module triggers" } },
  { tool: "project_mcp_manage", slice: "catalog", evidence: { kind: "cited", file: "lib/mcp/tools-project-mcp-manage.ts", line: 11, note: "project_mcp_manage is the capability form of the Extensions install panel" } },
  { tool: "project_mcp_tools", slice: "catalog", evidence: { kind: "cited", file: "lib/mcp/tools-project-mcp.ts", line: 19, note: "project_mcp_tools lists the tools the Extensions inspector shows" } },
  { tool: "project_mcp_call", slice: "catalog", evidence: { kind: "cited", file: "lib/mcp/tools-project-mcp.ts", line: 42, note: "project_mcp_call is the same project MCP path the catalog module exercises" } },
  { tool: "infra_providers_list", slice: "infra", evidence: { kind: "cited", file: "lib/mcp/tools-infra.ts", line: 58, note: "infra_providers_list is the capability form of the infra provider inventory" } },
  { tool: "dokploy_projects_list", slice: "infra", evidence: { kind: "cited", file: "lib/mcp/tools-infra.ts", line: 58, note: "the infra module renders the same Dokploy project inventory" } },
  { tool: "cloudflare_zones_list", slice: "infra", evidence: { kind: "cited", file: "lib/mcp/tools-infra.ts", line: 86, note: "the infra module renders the same Cloudflare zone inventory" } },
  { tool: "route:/api/v1/workflow-embeds", slice: "runtime-apps", evidence: { kind: "cited", file: "lib/host/workflow-embeds-service.ts", line: 28, note: "runtime-apps hosts the reviewed n8n workflow-embed workspace" } },
  { tool: "route:/api/v1/memory-graph", slice: "memory-graph", evidence: { kind: "cited", file: "lib/memory-graph/vault.ts", line: 10, note: "the memory-graph module reads the bounded graph build" } },
  { tool: "route:/api/v1/term/open", slice: "terminal", evidence: { kind: "cited", file: "lib/host/term-service.ts", line: 16, note: "the terminal module is the sole caller of the PTY open route" } },
  { tool: "route:/api/v1/sys/stats", slice: "monitor", evidence: { kind: "cited", file: "lib/host/sys-services-service.ts", line: 14, note: "the monitor module polls host telemetry on an interval" } },
];

const BY_TOOL = new Map(ATTRIBUTION.map((row) => [row.tool, row.slice]));

export function sliceForTool(tool: string): string | null {
  return BY_TOOL.get(tool) ?? null;
}

export function instrumentedSlices(): string[] {
  return [...new Set(ATTRIBUTION.filter((row) => !row.tool.startsWith("route:")).map((row) => row.slice))].sort();
}

export function documentedOnlySlices(): string[] {
  const instrumented = new Set(instrumentedSlices());
  return [...new Set(ATTRIBUTION.filter((row) => row.tool.startsWith("route:")).map((row) => row.slice))]
    .filter((slice) => !instrumented.has(slice))
    .sort();
}
