import type { Provenance } from "./types";

/**
 * Capability tool → the frontend slice that owns that capability's user-facing
 * surface.
 *
 * Attribution is only asserted where this repository proves it: the tool's
 * implementation module AND a file in the slice both exist for the same concept.
 * A tool that no slice owns, or that many slices call, stays unattributed and
 * reports as `unaccounted` instead of being guessed into the nearest slice.
 *
 * Two kinds of row, and they are NOT equivalent:
 *   - a capability tool name: its calls flow through `executeCapabilityCall`, so the
 *     slice gets real measured samples.
 *   - a `route:` pseudo-tool: it documents which slice owns a direct HTTP route, but
 *     that route is not the capability kernel, so no ledger sample is recorded for
 *     it. Those slices report `not-instrumented` actuals until an attributed
 *     capability call happens.
 *
 * Each row cites the tool module; `registry.test.ts` re-checks the slice directory
 * exists, so a slice rename breaks the map instead of silently mis-attributing.
 */
export type AttributionRow = {
  /** MCP capability tool name, or a `route:` pseudo-tool for a direct HTTP route. */
  tool: string;
  slice: string;
  evidence: Provenance;
};

export const ATTRIBUTION: readonly AttributionRow[] = [
  // lib/workflow is owned by the workflows slice, which calls the same routes.
  { tool: "workflow_graph", slice: "workflows", evidence: { kind: "cited", file: "lib/mcp/tools-flows.ts", line: 71, note: "workflow_graph is the capability form of the workflows slice's own graph store" } },
  { tool: "flow_run", slice: "workflows", evidence: { kind: "cited", file: "lib/mcp/tools-flows.ts", line: 43, note: "flow_run drives the same workflow/flows domain the slice edits" } },
  { tool: "flow_status", slice: "workflows", evidence: { kind: "cited", file: "lib/mcp/tools-flows.ts", line: 43, note: "flow_status polls the run the slice started" } },
  { tool: "flow_manage", slice: "workflows", evidence: { kind: "cited", file: "lib/mcp/tools-flows.ts", line: 57, note: "flow_manage edits the slice's own automation records" } },
  // Organization tools are the capability form of the organization slice's chart.
  { tool: "organization_chart", slice: "organization", evidence: { kind: "cited", file: "lib/mcp/tools-organization.ts", line: 10, note: "organization_chart reads the same chart the slice renders" } },
  { tool: "organization_manage", slice: "organization", evidence: { kind: "cited", file: "lib/mcp/tools-organization.ts", line: 22, note: "organization_manage mutates the same chart the slice edits" } },
  // The vault slice is the only surface over the project agent vault.
  { tool: "project_agent_vault_read", slice: "agent-vault", evidence: { kind: "cited", file: "lib/mcp/tools-agent-vault.ts", line: 9, note: "project_agent_vault_read is the capability form of the vault the slice shows" } },
  { tool: "project_agent_vault_sync", slice: "agent-vault", evidence: { kind: "cited", file: "lib/mcp/tools-agent-vault.ts", line: 19, note: "project_agent_vault_sync performs the same vault sync the slice triggers" } },
  // Extensions owns the project MCP install and inspection surface.
  { tool: "project_mcp_manage", slice: "extensions", evidence: { kind: "cited", file: "lib/mcp/tools-project-mcp-manage.ts", line: 11, note: "project_mcp_manage is the capability form of the install panel the slice renders" } },
  { tool: "project_mcp_tools", slice: "extensions", evidence: { kind: "cited", file: "lib/mcp/tools-project-mcp.ts", line: 19, note: "project_mcp_tools lists the tools the slice's inspector shows" } },
  { tool: "project_mcp_call", slice: "extensions", evidence: { kind: "cited", file: "lib/mcp/tools-project-mcp.ts", line: 42, note: "project_mcp_call is the same project MCP path the slice exercises" } },
  // Infrastructure owns every provider inventory and DNS mutation.
  { tool: "infra_providers_list", slice: "infrastructure", evidence: { kind: "cited", file: "lib/mcp/tools-infra.ts", line: 58, note: "infra_providers_list is the capability form of the slice's provider inventory" } },
  { tool: "dokploy_projects_list", slice: "infrastructure", evidence: { kind: "cited", file: "lib/mcp/tools-infra.ts", line: 58, note: "the slice renders the same Dokploy project inventory" } },
  { tool: "cloudflare_zones_list", slice: "infrastructure", evidence: { kind: "cited", file: "lib/mcp/tools-infra.ts", line: 86, note: "the slice renders the same Cloudflare zone inventory" } },
  // n8n has exactly one server surface: workflow embeds.
  { tool: "route:/api/v1/workflow-embeds", slice: "n8n", evidence: { kind: "cited", file: "lib/host/workflow-embeds-service.ts", line: 28, note: "the slice's only server call is the bounded workflow-embed read" } },
  // Memory graph has exactly one server surface.
  { tool: "route:/api/v1/memory-graph", slice: "memory-graph", evidence: { kind: "cited", file: "frontend/slices/memory-graph/components/memory-graph-screen.tsx", line: 24, note: "the slice's only server call is the bounded graph build" } },
  // The terminal slice is the only PTY surface.
  { tool: "route:/api/v1/term/open", slice: "os-terminal", evidence: { kind: "cited", file: "lib/host/term-service.ts", line: 16, note: "the slice is the only caller of the PTY open route" } },
  // System monitor is the only sys/* consumer that polls on an interval.
  { tool: "route:/api/v1/sys/stats", slice: "system-monitor", evidence: { kind: "cited", file: "frontend/slices/system-monitor/lib/use-stats-history.ts", line: 8, note: "the slice polls this route on its own interval" } },
];

const BY_TOOL = new Map(ATTRIBUTION.map((row) => [row.tool, row.slice]));

/** Slice that owns a capability tool, or null when no slice provably owns it. */
export function sliceForTool(tool: string): string | null {
  return BY_TOOL.get(tool) ?? null;
}

/**
 * Slices whose capability calls actually record a ledger sample. This is the honest
 * measured-coverage set: `route:` rows document ownership but do not instrument.
 */
export function instrumentedSlices(): string[] {
  return [...new Set(ATTRIBUTION.filter((row) => !row.tool.startsWith("route:")).map((row) => row.slice))].sort();
}

/** Slices whose only attribution is a documented HTTP route, not a measured call. */
export function documentedOnlySlices(): string[] {
  const instrumented = new Set(instrumentedSlices());
  return [...new Set(ATTRIBUTION.filter((row) => row.tool.startsWith("route:")).map((row) => row.slice))]
    .filter((slice) => !instrumented.has(slice))
    .sort();
}
