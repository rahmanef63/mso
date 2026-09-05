import type { Scope } from "./scope";
import type { McpTool } from "./tool-kit";

export type McpToolProfile = "full" | "chatgpt";
export type McpToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
  idempotentHint?: boolean;
};
export type McpSecurityScheme = { type: "oauth2"; scopes: string[] } | { type: "noauth" };

/**
 * ChatGPT's scanner recommends output schemas for every tool that returns
 * structured data. Most MSO tools intentionally keep provider/project-specific
 * result shapes dynamic, so duplicating dozens of hand-maintained schemas would
 * create drift. The compact profile therefore uses one exact outer envelope for
 * tools without a richer explicit contract. `result` is the bounded JSON value
 * already produced by the tool. Full/generic MCP clients keep the historical
 * descriptor unless a tool declares its own outputSchema.
 */
export const CHATGPT_RESULT_OUTPUT_SCHEMA = {
  type: "object",
  properties: { result: {} },
  required: ["result"],
  additionalProperties: false,
} as const;

export function outputSchemaForProfile(tool: McpTool, profile: McpToolProfile = "full"): Record<string, unknown> | undefined {
  return tool.outputSchema ?? (profile === "chatgpt" ? CHATGPT_RESULT_OUTPUT_SCHEMA : undefined);
}

// ChatGPT scans a frozen descriptor snapshot. Keep that public snapshot deliberately
// small; every name here is an MSO-owned generic primitive. Project-owned MCP tool
// names are discovered/called dynamically through project_mcp_* and NEVER appended
// to this list or TOOLS.
export const CHATGPT_TOOL_NAMES = new Set([
  // Workflow/session intelligence. workflow_status and render_mso_surface stay app-only at presentation time.
  "workflow_start", "workflow_status", "workflow_finish", "workflow_cancel",
  "skills_search", "skills_list", "skills_read", "read_pipeline",
  "agent_session_current", "agent_session_rename",
  "local_agents_list", "local_agent_inbox", "local_agent_message_send", "local_agent_reply", "local_agent_request_wait",

  // Project-first operator surface. Project-owned names remain dynamic.
  "projects_list", "project_get", "project_changes_list", "project_diff", "project_capabilities",
  "project_knowledge_get", "project_knowledge_set", "connections_list", "project_agent_run", "project_agent_status",
  "project_mcp_tools", "project_mcp_call", "project_function_call",
  "project_database_status", "project_database_tools", "project_database_call", "project_database_query",

  // Original MSO bounded VPS/file/application/browser power restored to ChatGPT.
  "vps_status", "mso_surface_apps_list", "render_mso_block", "render_mso_page", "render_mso_surface", "screen_capture", "fs_list", "fs_read", "fs_search", "fs_usage",
  "fs_write", "fs_upload_file", "fs_mkdir", "fs_move", "fs_copy", "fs_delete",
  "sys_stats", "sys_processes", "apps_list", "apps_logs", "apps_power", "browser_status", "browser_power",

  // Infrastructure operations remain explicit and bounded; secrets stay server-side.
  "integration_setup_open", "infra_providers_list", "infra_provider_doctor", "dokploy_projects_list", "dokploy_project_ensure",
  "cloudflare_zones_list", "cloudflare_dns_upsert", "hostinger_dns_upsert",

  // Arbitrary shell is still a last-resort escape hatch and long builds remain job-bound.
  "exec_run", "exec_job_start", "exec_job_status", "exec_job_cancel",
] as const);

const TITLES: Record<string, string> = {
  workflow_start: "Start Workflow", workflow_status: "Workflow Status", workflow_finish: "Finish Workflow", workflow_cancel: "Cancel Workflow",
  render_mso_block: "Render MSO Block", render_mso_page: "Render MSO Page", render_mso_surface: "Render MSO Surface (Compatibility)",
  skills_search: "Search Skills", projects_list: "List Projects", project_capabilities: "Project Capabilities",
  project_mcp_tools: "List Project MCP Tools", project_mcp_call: "Call Project MCP Tool", project_function_call: "Call Project Function",
  read_pipeline: "Run Read Pipeline", fs_list: "List Files", fs_read: "Read File", fs_search: "Search Directories", fs_write: "Write File",
  exec_run: "Run Command", exec_job_start: "Start Command Job", exec_job_status: "Command Job Status", exec_job_cancel: "Cancel Command Job",
  agent_session_current: "Current Agent Session", agent_session_rename: "Rename Agent Session",
  local_agents_list: "List Local Agents", local_agent_inbox: "Receive Local Agent Messages",
  local_agent_message_send: "Send Local Agent Message", local_agent_reply: "Reply to Local Agent", local_agent_request_wait: "Wait for Local Agent Reply",
  a2a_agent_discover: "Discover A2A Agent", a2a_agents_list: "List A2A Agents", a2a_message_send: "Send A2A Message",
  cloudflare_dns_upsert: "Upsert Cloudflare DNS", hostinger_dns_upsert: "Upsert Hostinger DNS",
};
const ACRONYMS = new Map([["mcp", "MCP"], ["a2a", "A2A"], ["dns", "DNS"], ["fs", "Files"], ["api", "API"], ["ui", "UI"]]);

export function toolTitle(name: string): string {
  if (TITLES[name]) return TITLES[name];
  return name.split(/[_\.]+/).filter(Boolean).map((word) => ACRONYMS.get(word) ?? `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ").slice(0, 80);
}

// Only declarations that can overwrite/delete/send/cancel or run arbitrary code
// need an override. Everything else inherits the safe scope-based default below.
const DESTRUCTIVE = new Set([
  "fs_write", "fs_upload_file", "fs_move", "fs_copy", "fs_delete",
  "exec_run", "exec_job_start", "exec_job_cancel", "project_function_call", "project_mcp_call",
  "local_agent_message_send", "local_agent_reply", "a2a_message_send", "a2a_task_cancel", "a2a_agent_remove",
  "cloudflare_dns_upsert", "hostinger_dns_upsert", "apps_power", "browser_power", "tool_forge_promote",
  "agent_memory_forget", "project_memory_upsert", "workflow_cancel",
]);

const OPEN_WORLD = new Set([
  "exec_run", "exec_job_start", "project_function_call", "project_mcp_call", "fs_upload_file",
  "a2a_agent_discover", "a2a_message_send", "a2a_task_get", "a2a_task_cancel", "a2a_handoff",
  "infra_provider_doctor", "dokploy_projects_list", "dokploy_project_ensure", "cloudflare_zones_list",
  "cloudflare_dns_upsert", "hostinger_dns_upsert",
]);

export function completeToolAnnotations(tool: McpTool): McpToolAnnotations {
  const supplied = tool.annotations ?? {};
  return {
    readOnlyHint: typeof supplied.readOnlyHint === "boolean" ? supplied.readOnlyHint : tool.scope === "read",
    destructiveHint: typeof supplied.destructiveHint === "boolean" ? supplied.destructiveHint : DESTRUCTIVE.has(tool.name),
    openWorldHint: typeof supplied.openWorldHint === "boolean" ? supplied.openWorldHint : OPEN_WORLD.has(tool.name),
    ...(typeof supplied.idempotentHint === "boolean" ? { idempotentHint: supplied.idempotentHint } : {}),
  };
}

export function toolSecuritySchemes(tool: McpTool): McpSecurityScheme[] {
  return tool.securitySchemes ?? [{ type: "oauth2", scopes: [tool.scope] }];
}

export function toolAllowedForProfile(name: string, profile: McpToolProfile = "full"): boolean {
  return profile === "full" || CHATGPT_TOOL_NAMES.has(name as never);
}

function compactText(value: string, max = 190): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return `${(sentence > 100 ? cut.slice(0, sentence + 1) : cut).trim()}…`;
}

function compactSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactSchema);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "description" && typeof item === "string") out[key] = compactText(item, 105);
    else out[key] = compactSchema(item);
  }
  return out;
}

export function toolDescriptor(tool: McpTool, profile: McpToolProfile = "full") {
  const securitySchemes = toolSecuritySchemes(tool);
  const meta = { ...(tool.meta ?? {}), securitySchemes };
  const compact = profile === "chatgpt";
  const outputSchema = outputSchemaForProfile(tool, profile);
  return {
    name: tool.name,
    title: tool.title ?? toolTitle(tool.name),
    description: compact ? compactText(tool.chatgptDescription ?? tool.description) : tool.description,
    inputSchema: compact ? compactSchema(tool.inputSchema) : tool.inputSchema,
    ...(outputSchema ? { outputSchema: compact ? compactSchema(outputSchema) : outputSchema } : {}),
    securitySchemes,
    annotations: completeToolAnnotations(tool),
    _meta: meta,
  };
}

export function visibleToolsForProfile(tools: readonly McpTool[], scope: Scope, profile: McpToolProfile = "full"): McpTool[] {
  const rank: Record<Scope, number> = { read: 0, write: 1, exec: 2 };
  return tools.filter((tool) => rank[scope] >= rank[tool.scope] && toolAllowedForProfile(tool.name, profile));
}
