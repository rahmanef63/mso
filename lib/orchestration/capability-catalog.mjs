const ROUTES = [
  { id: "managed-app-diagnostics", priority: 100, patterns: [/\b(hermes|openclaw|managed app|service)\b.*\b(down|error|crash|logs?|journal|status)\b/i, /\b(logs?|journal)\b.*\b(hermes|openclaw|service)\b/i], tools: ["apps_list", "apps_logs"], budget: 8_000 },
  { id: "managed-app-power", priority: 100, patterns: [/\b(start|stop|restart|backup)\b.*\b(hermes|openclaw|managed app|service)\b/i], tools: ["apps_list", "apps_power"], budget: 8_000 },
  { id: "server-health", priority: 95, patterns: [/\b(vps|server|host)\b.*\b(health|cpu|ram|memory|disk|uptime|load|process)\b/i, /\b(cpu|ram|disk|uptime|top processes?)\b/i], tools: ["sys_stats", "sys_processes"], budget: 8_000 },
  { id: "project-manual-test", priority: 95, patterns: [/\b(tested|testing|manual test|debug|regression|freeze[sd]?|frozen|crash(?:ed)?|fail(?:ed|ure)?|still broken|masih|gagal|uji manual|sudah (?:tes|test|uji))\b/i], tools: ["project_memory_search", "project_memory_upsert"], budget: 12_000 },
  { id: "project-memory", priority: 90, patterns: [/\b(repo|project)[ -]?(memory|history|timeline|decision|failure|debug)\b/i, /\b(previous|prior)\b.*\b(debug|test|decision|failure|implementation)\b/i], tools: ["project_memory_search"], budget: 12_000 },
  { id: "agent-memory", priority: 90, patterns: [/\b(remember|recall|forget|persistent memory|agent memory|provenance|temporal claim|conflicting claim)\b/i], tools: ["agent_memory_search", "agent_memory_read", "agent_memory_remember", "agent_memory_forget"], budget: 10_000 },
  { id: "long-pipeline", priority: 90, patterns: [/\b(run|rerun|execute|jalankan|ulang(?:i)?|full|complete|entire|production)\b.{0,32}\b(test|tests|build|lint|verify|verification|coverage|pipeline|security scan|tes|uji|verifikasi)\b/i, /\b(test|tests|build|verify|coverage|tes|uji|verifikasi)\b.*\b(minutes?|long|full|production|semua|seluruh|lengkap)\b/i], tools: ["exec_job_start", "exec_job_status", "exec_job_cancel"], budget: 12_000 },
  { id: "short-shell", priority: 75, patterns: [/\b(git status|git diff|git log|short command|shell command|terminal command)\b/i], tools: ["exec_run"], budget: 8_000 },
  { id: "file-read", priority: 70, patterns: [
    /\b(read|inspect|show|open|cat|baca|lihat|cek|check)\b.*\b(file|readme|config|source|code|berkas|kode)\b/i,
    /\b(read|inspect|show|open|cat|baca|lihat|cek|check)\b.{0,220}(?:~\/|\/(?:home|tmp|var|srv|opt|run)\/)[^\s,;]+/i,
  ], tools: ["fs_read"], budget: 8_000 },
  { id: "file-write", priority: 80, patterns: [/\b(write|edit|update|modify|patch|refactor|fix|ubah|perbarui|perbaiki|rapikan)\b.*\b(file|readme|config|source|code|docs?|berkas|kode|dokumentasi)\b/i], tools: ["fs_read", "fs_write"], budget: 12_000 },
  { id: "project-function", priority: 90, patterns: [/\b(project function|declared function|automation function|project capability)\b/i], tools: ["project_capabilities", "project_function_call"], budget: 10_000 },
  { id: "project-discovery", priority: 65, patterns: [/\b(find|list|locate|which|cari|temukan|daftar)\b.*\b(project|repo|repository|workspace|proyek)\b/i], tools: ["projects_list"], budget: 8_000 },
  { id: "skills", priority: 65, patterns: [/\b(skill|capability|recipe|how do i|how to|best practice|cara|kemampuan)\b/i], tools: ["skills_search", "skills_read"], budget: 10_000 },
  { id: "browser", priority: 85, patterns: [/\b(camoufox|browser|firefox|vnc)\b/i], tools: ["browser_status", "browser_power"], budget: 8_000 },
  { id: "screen", priority: 90, patterns: [/\b(screenshot|screen capture|capture the .*screen|visual proof)\b/i], tools: ["screen_capture"], budget: 8_000 },
  { id: "cloudflare-dns", priority: 100, patterns: [/\bcloudflare\b.*\b(dns|zone|record)\b/i], tools: ["cloudflare_zones_list", "cloudflare_dns_upsert"], budget: 10_000 },
  { id: "hostinger-dns", priority: 100, patterns: [/\bhostinger\b.*\b(dns|domain|record)\b/i], tools: ["hostinger_dns_upsert"], budget: 10_000 },
  { id: "dokploy", priority: 95, patterns: [/\bdokploy\b/i], tools: ["dokploy_projects_list", "dokploy_project_ensure"], budget: 10_000 },
  { id: "local-agent", priority: 100, patterns: [/\b(local|same[- ]host|session)\b.*\b(agent|delegate|message|inbox|request|reply)\b/i, /\blocal_agent_/i], tools: ["local_agents_list", "local_agent_inbox", "local_agent_message_send", "local_agent_reply", "local_agent_request_wait", "local_agent_request"], budget: 12_000 },
  { id: "subagent", priority: 100, patterns: [/\b(subagent|spawn .*reviewer|spawn .*worker|independent reviewer|isolated worker)\b/i], tools: ["agent_subagent_run"], budget: 12_000 },
  { id: "a2a", priority: 100, patterns: [/\b(a2a|agent card|remote agent|peer agent|handoff)\b/i], tools: ["a2a_agents_list", "a2a_agent_discover", "a2a_message_send", "a2a_handoff", "a2a_task_get"], budget: 12_000 },
  { id: "forge", priority: 100, patterns: [/\b(tool forge|forge candidate|promote .*tool|self[- ]improv|generate tool)\b/i], tools: ["tool_forge_candidates", "tool_forge_propose", "tool_forge_evaluate", "tool_forge_promote"], budget: 12_000 },
  { id: "read-pipeline", priority: 98, patterns: [
    /\b(read pipeline|read_pipeline|batch|aggregate|aggregation|filter|projection|bulk read|multiple reads|orchestrat(?:e|ion))\b/i,
    /\b(read|inspect|baca)\b.{0,40}\b(both|multiple|several|dua|beberapa)\b.*\b(sum|count|average|avg|aggregate|gabung|jumlah|total)\b/i,
  ], tools: ["read_pipeline"], budget: 8_000 },
  { id: "session-resume", priority: 90, patterns: [/\b(resume|continue|list|previous)\b.*\b(session|conversation|thread)\b/i], tools: ["agent_sessions_list", "agent_session_resume"], budget: 12_000 },
  { id: "repo-change", priority: 55, patterns: [/\b(implement|refactor|fix|update|change|migrate|add|remove|cleanup|audit|terapkan|implementasi|perbaiki|ubah|tambahkan|hapus|rapikan)\b.*\b(repo|repository|project|codebase|runtime|architecture|feature|system|proyek|kode|arsitektur|fitur|sistem)\b/i], tools: ["workflow_start"], budget: 16_000 },
];

const CONTINUATION = /^(?:ok(?:e|ay)?|ya|yes|lanjut(?:kan)?|continue|go on|do it|terapkan|lakukan|fix it|that|this|same|again|\[continue\])(?:\b|$)[\s.!?,-]*$/i;

function textOf(row) {
  if (!row || typeof row !== "object") return "";
  if (typeof row.text === "string") return row.text;
  return "";
}

export function latestIntentText(history = []) {
  const users = history.filter((row) => row?.role === "user" && textOf(row).trim());
  const latest = textOf(users.at(-1)).trim();
  if (!latest) return "";
  const short = latest.split(/\s+/).length <= 8;
  if (!short || !CONTINUATION.test(latest)) return latest.slice(0, 6_000);
  const previous = textOf(users.at(-2)).trim();
  return `${previous}\n${latest}`.slice(-8_000);
}

export function routeIntentText(userText = "", skillContext = null) {
  const skillMeta = [skillContext?.id, skillContext?.name, skillContext?.description].filter(Boolean).join(" ").slice(0, 512);
  const text = `${String(userText || "").slice(-8_000)}\n${skillMeta}`.trim();
  const matches = ROUTES
    .filter((route) => route.patterns.some((pattern) => pattern.test(text)))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const selected = [];
  for (const route of matches) {
    if (selected.length >= 4) break;
    if (selected.some((row) => row.id === route.id)) continue;
    selected.push(route);
  }
  const tools = [...new Set(selected.flatMap((route) => route.tools))];
  const continuation = Boolean(userText && String(userText).includes("\n"));
  const budget = selected.length
    ? Math.max(...selected.map((route) => route.budget), continuation ? 20_000 : 0)
    : continuation ? 20_000 : 12_000;
  return {
    text,
    routeIds: selected.map((route) => route.id),
    tools,
    continuation,
    historyBudgetTokens: Math.min(24_000, budget),
    catalogMatched: selected.length > 0,
  };
}

export function routeIntent(history = [], skillContext = null) {
  return routeIntentText(latestIntentText(history), skillContext);
}

export function intentCatalogSummary() {
  return ROUTES.map(({ id, tools, budget }) => ({ id, tools: [...tools], historyBudgetTokens: budget }));
}
