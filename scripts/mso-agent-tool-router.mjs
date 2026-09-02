import { routeIntent } from "../lib/orchestration/capability-catalog.mjs";

export const MAX_ACTIVE_TOOLS = 10;
const FALLBACK_TOOL_LIMIT = 3;

const DEPENDENCIES = new Map([
  ["apps_logs", ["apps_list"]],
  ["apps_power", ["apps_list"]],
  ["project_function_call", ["project_capabilities"]],
  ["exec_job_start", ["exec_job_status", "exec_job_cancel"]],
  ["fs_write", ["fs_read"]],
  ["project_memory_upsert", ["project_memory_search"]],
  ["agent_session_resume", ["agent_sessions_list"]],
  ["local_agent_message_send", ["local_agents_list", "local_agent_inbox", "local_agent_reply"]],
  ["local_agent_reply", ["local_agent_inbox", "local_agents_list"]],
  ["local_agent_request", ["local_agents_list", "local_agent_request_wait"]],
  ["agent_subagent_run", ["skills_search", "projects_list"]],
  ["a2a_message_send", ["a2a_agents_list", "a2a_agent_discover"]],
  ["a2a_handoff", ["a2a_agents_list", "a2a_agent_discover", "a2a_task_get"]],
  ["tool_forge_evaluate", ["tool_forge_candidates"]],
  ["tool_forge_promote", ["tool_forge_candidates", "tool_forge_evaluate"]],
]);

const LIFECYCLE = new Map([
  ["workflow_start", ["workflow_finish", "workflow_cancel", "skills_read", "project_script_run"]],
  ["exec_job_start", ["exec_job_status", "exec_job_cancel"]],
  ["skills_search", ["skills_read"]],
  ["local_agent_message_send", ["local_agent_inbox", "local_agent_reply"]],
  ["local_agent_request", ["local_agent_request_wait"]],
  ["a2a_message_send", ["a2a_task_get"]],
  ["a2a_handoff", ["a2a_task_get"]],
  ["tool_forge_propose", ["tool_forge_candidates", "tool_forge_evaluate"]],
  ["tool_forge_evaluate", ["tool_forge_candidates", "tool_forge_promote"]],
]);

function messageText(row) {
  if (!row || typeof row !== "object") return "";
  if (typeof row.text === "string") return row.text;
  if (row.role === "tool" && Array.isArray(row.results)) {
    return row.results.map((result) => String(result?.content || "")).join("\n");
  }
  return "";
}

function recentDiscoveryText(history = []) {
  return history
    .slice(-4)
    .filter((row) => row?.role === "tool")
    .map(messageText)
    .filter(Boolean)
    .join("\n")
    .slice(-4_000);
}

function referencedTools(allTools, text) {
  const lower = String(text || "").toLowerCase();
  return allTools
    .filter((tool) => lower.includes(String(tool.name).toLowerCase()))
    .map((tool) => String(tool.name));
}

function previousToolNames(history = []) {
  const names = [];
  for (const row of history.slice(-8)) {
    if (row?.role !== "assistant" || !Array.isArray(row.toolUses)) continue;
    for (const call of row.toolUses) if (call?.name) names.push(String(call.name));
  }
  return [...new Set(names)];
}

function lexicalScore(tool, text) {
  const query = new Set(String(text || "").toLowerCase().split(/[^a-z0-9_./-]+/).filter((token) => token.length >= 3));
  const name = String(tool?.name || "").toLowerCase();
  const props = Object.keys(tool?.inputSchema?.properties || {}).join(" ").toLowerCase();
  const haystack = `${name} ${String(tool?.description || "").toLowerCase()} ${props}`;
  let score = 0;
  for (const token of query) {
    if (name === token) score += 12;
    else if (name.includes(token)) score += 5;
    if (haystack.includes(token)) score += 1;
  }
  if (name && String(text || "").toLowerCase().includes(name)) score += 20;
  return score;
}

function addDependencies(selected, byName) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of [...selected]) {
      for (const dependency of DEPENDENCIES.get(name) || []) {
        if (byName.has(dependency) && !selected.has(dependency)) {
          selected.add(dependency);
          changed = true;
        }
      }
    }
  }
}


export function selectToolsForTurn(allTools = [], history = [], skillContext = null, maxActive = MAX_ACTIVE_TOOLS) {
  const byName = new Map(allTools.map((tool) => [String(tool.name), tool]));
  const route = routeIntent(history, skillContext);
  const discoveryText = recentDiscoveryText(history);
  const selected = new Set();
  const add = (name) => { if (byName.has(name)) selected.add(name); };

  for (const name of route.tools) add(name);
  for (const name of referencedTools(allTools, `${route.text}\n${discoveryText}`)) add(name);

  const previous = previousToolNames(history);
  for (const name of previous) {
    for (const companion of LIFECYCLE.get(name) || []) add(companion);
    if (route.continuation && byName.has(name)) add(name);
  }
  if (previous.includes("workflow_start")) {
    selected.delete("workflow_start");
    if (route.routeIds.includes("repo-change")) {
      for (const name of ["fs_read", "fs_write", "exec_run", "exec_job_start"]) add(name);
    }
  }

  let fallbackUsed = false;
  if (!route.catalogMatched && selected.size === 0) {
    fallbackUsed = true;
    add("skills_search");
    const ranked = allTools
      .map((tool) => ({ tool, score: lexicalScore(tool, route.text) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || String(a.tool.name).localeCompare(String(b.tool.name)))
      .slice(0, FALLBACK_TOOL_LIMIT);
    for (const { tool } of ranked) add(String(tool.name));
  }

  addDependencies(selected, byName);

  // Catalog packs are deliberately small. Dependencies may exceed the soft cap
  // rather than dropping a required companion and forcing another model round.
  const tools = allTools.filter((tool) => selected.has(String(tool.name)));

  return {
    tools,
    selectedNames: tools.map((tool) => String(tool.name)),
    fullCount: allTools.length,
    activeCount: tools.length,
    softLimit: maxActive,
    routeIds: route.routeIds,
    catalogMatched: route.catalogMatched,
    fallbackUsed,
    continuation: route.continuation,
    historyBudgetTokens: route.historyBudgetTokens,
    routingTextBytes: Buffer.byteLength(`${route.text}\n${discoveryText}`, "utf8"),
  };
}

