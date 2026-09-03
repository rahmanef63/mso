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

// ChatGPT scans a frozen descriptor snapshot. Keep that public snapshot deliberately
// small; every name here is an MSO-owned generic primitive. Project-owned MCP tool
// names are discovered/called dynamically through project_mcp_* and NEVER appended
// to this list or TOOLS.
export const CHATGPT_TOOL_NAMES = new Set([
  "workflow_start", "workflow_status", "workflow_finish", "workflow_cancel",
  "skills_search", "skills_read", "projects_list", "project_capabilities", "project_mcp_tools", "project_mcp_call", "project_function_call",
  "read_pipeline", "screen_capture", "fs_list", "fs_read", "fs_search", "fs_write", "fs_upload_file",
  "exec_run", "exec_job_start", "exec_job_status", "exec_job_cancel",
  "agent_session_current", "agent_session_rename",
  "local_agents_list", "local_agent_inbox", "local_agent_message_send", "local_agent_reply", "local_agent_request_wait",
] as const);

const TITLES: Record<string, string> = {
  workflow_start: "Start Workflow", workflow_status: "Workflow Status", workflow_finish: "Finish Workflow", workflow_cancel: "Cancel Workflow",
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

function compactText(value: string, max = 280): string {
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
    if (key === "description" && typeof item === "string") out[key] = compactText(item, 180);
    else out[key] = compactSchema(item);
  }
  return out;
}

export function toolDescriptor(tool: McpTool, profile: McpToolProfile = "full") {
  const securitySchemes = toolSecuritySchemes(tool);
  const meta = { ...(tool.meta ?? {}), securitySchemes };
  const compact = profile === "chatgpt";
  return {
    name: tool.name,
    title: tool.title ?? toolTitle(tool.name),
    description: compact ? compactText(tool.chatgptDescription ?? tool.description) : tool.description,
    inputSchema: compact ? compactSchema(tool.inputSchema) : tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: compact ? compactSchema(tool.outputSchema) : tool.outputSchema } : {}),
    securitySchemes,
    annotations: completeToolAnnotations(tool),
    _meta: meta,
  };
}

export function visibleToolsForProfile(tools: readonly McpTool[], scope: Scope, profile: McpToolProfile = "full"): McpTool[] {
  const rank: Record<Scope, number> = { read: 0, write: 1, exec: 2 };
  return tools.filter((tool) => rank[scope] >= rank[tool.scope] && toolAllowedForProfile(tool.name, profile));
}
