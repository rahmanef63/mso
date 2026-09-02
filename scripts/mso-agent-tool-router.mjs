const CORE_TOOL_NAMES = new Set([
  "workflow_start", "workflow_status", "workflow_finish", "workflow_cancel",
  "skills_search", "projects_list", "project_capabilities", "agent_session_current",
]);

export const MAX_ACTIVE_TOOLS = 14;

const DEPENDENCIES = new Map([
  ["apps_logs", ["apps_list"]],
  ["project_function_call", ["project_capabilities"]],
  ["exec_job_start", ["exec_job_status", "exec_job_cancel"]],
  ["fs_write", ["fs_read"]],
  ["agent_session_resume", ["agent_sessions_list"]],
  ["local_agent_message_send", ["local_agents_list", "local_agent_inbox"]],
  ["a2a_message_send", ["a2a_agents_list", "a2a_agent_discover"]],
  ["a2a_handoff", ["a2a_agents_list", "a2a_agent_discover", "a2a_task_get"]],
  ["tool_forge_evaluate", ["tool_forge_candidates"]],
  ["tool_forge_promote", ["tool_forge_candidates", "tool_forge_evaluate"]],
]);

const ALIASES = new Map([
  ["logs", ["log", "journal", "error", "crash", "down"]],
  ["processes", ["process", "cpu", "ram", "load"]],
  ["memory", ["memory", "remember", "recall", "forget", "fact", "preference", "provenance", "conflict", "temporal"]],
  ["stats", ["health", "cpu", "memory", "ram", "disk", "uptime", "server", "vps"]],
  ["projects", ["project", "repo", "repository", "checkout", "workspace"]],
  ["skills", ["skill", "capability", "recipe", "workflow", "how"]],
  ["read", ["read", "inspect", "show", "cat", "file"]],
  ["write", ["write", "edit", "update", "modify", "patch", "file"]],
  ["exec", ["run", "shell", "command", "terminal", "test", "build", "lint", "deploy"]],
  ["browser", ["browser", "camoufox", "firefox", "vnc"]],
  ["screen", ["screen", "screenshot", "visual", "image"]],
  ["cloudflare", ["cloudflare", "dns", "zone", "record"]],
  ["dokploy", ["dokploy", "deploy", "deployment", "project"]],
  ["hostinger", ["hostinger", "dns", "domain", "record"]],
  ["apps", ["app", "service", "hermes", "openclaw", "install", "restart", "status"]],
  ["localagent", ["local", "session", "agent", "message", "task", "delegate", "delegation", "collaborate", "inbox"]],
  ["a2a", ["a2a", "remote", "agent card", "peer", "handoff"]],
  ["forge", ["forge", "candidate", "promotion", "promote", "self-improve", "self-improving", "generate tool", "tool creator"]],
]);

function words(value) {
  const raw = String(value || "").toLowerCase().replace(/[^a-z0-9_./-]+/g, " ");
  const out = new Set(raw.split(/\s+/).filter((v) => v.length >= 2));
  for (const [key, terms] of ALIASES) if (terms.some((term) => out.has(term))) out.add(key);
  return out;
}

function messageText(row) {
  if (!row || typeof row !== "object") return "";
  if (typeof row.text === "string") return row.text;
  if (row.role === "tool" && Array.isArray(row.results)) return row.results.map((r) => String(r?.content || "")).join("\n");
  return "";
}

export function turnSearchText(history = [], skillContext = null) {
  const recent = history.slice(-8).map(messageText).filter(Boolean).join("\n");
  const skill = skillContext?.content ? String(skillContext.content).slice(0, 16000) : "";
  return `${recent}\n${skill}`.slice(-48000);
}

function toolHaystack(tool) {
  const props = Object.keys(tool?.inputSchema?.properties || {}).join(" ");
  return `${tool?.name || ""} ${tool?.description || ""} ${props}`.toLowerCase();
}

function score(tool, queryWords, rawQuery) {
  const hay = toolHaystack(tool);
  const name = String(tool?.name || "").toLowerCase();
  let value = 0;
  for (const token of queryWords) {
    if (name === token) value += 12;
    else if (name.includes(token)) value += 5;
    if (hay.includes(token)) value += 1;
  }
  if (rawQuery.includes(name) && name) value += 18;
  const prefix = name.split("_")[0];
  if (prefix && queryWords.has(prefix)) value += 3;
  return value;
}

function referencedTools(allTools, text) {
  const lower = text.toLowerCase();
  return allTools.filter((tool) => lower.includes(String(tool.name).toLowerCase())).map((tool) => tool.name);
}

function previousToolNames(history = []) {
  const names = [];
  for (const row of history.slice(-12)) {
    if (row?.role !== "assistant" || !Array.isArray(row.toolUses)) continue;
    for (const call of row.toolUses) if (call?.name) names.push(String(call.name));
  }
  return names;
}

export function selectToolsForTurn(allTools = [], history = [], skillContext = null, maxActive = MAX_ACTIVE_TOOLS) {
  const byName = new Map(allTools.map((tool) => [String(tool.name), tool]));
  const text = turnSearchText(history, skillContext);
  const queryWords = words(text);
  const selected = new Set();
  const add = (name) => { if (byName.has(name)) selected.add(name); };

  for (const name of CORE_TOOL_NAMES) add(name);
  for (const name of previousToolNames(history)) add(name);
  for (const name of referencedTools(allTools, text)) add(name);

  const ranked = allTools
    .map((tool) => ({ tool, score: score(tool, queryWords, text.toLowerCase()) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || String(a.tool.name).localeCompare(String(b.tool.name)));

  for (const { tool } of ranked) {
    if (selected.size >= maxActive) break;
    add(String(tool.name));
  }

  for (const name of [...selected]) {
    for (const dependency of DEPENDENCIES.get(name) || []) add(dependency);
  }

  // Core + dependency safety may exceed the soft cap by a few entries. Prefer
  // capability correctness over silently dropping the status/cancel companion.
  const tools = allTools.filter((tool) => selected.has(String(tool.name)));
  return {
    tools,
    selectedNames: tools.map((tool) => String(tool.name)),
    fullCount: allTools.length,
    activeCount: tools.length,
    softLimit: maxActive,
  };
}

export function coreToolNames() { return [...CORE_TOOL_NAMES]; }
