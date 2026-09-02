#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { mock } from "bun:test";
import { selectToolsForTurn } from "./mso-agent-tool-router.mjs";
import { runMemoryRetrievalBenchmark } from "./bench-memory-retrieval.mjs";

mock.module("server-only", () => ({}));
const { TOOLS } = await import("../lib/mcp/tools.ts");

const scenarios = [
  { id: "app-logs", prompt: "Hermes is down. Check managed app state and inspect its recent logs.", required: ["apps_list", "apps_logs"] },
  { id: "server-health", prompt: "How is the VPS doing? Check cpu, ram, disk and top processes.", required: ["sys_stats", "sys_processes"] },
  { id: "safe-edit", prompt: "Inspect README then safely update that file without overwriting concurrent changes.", required: ["fs_read", "fs_write"] },
  { id: "long-build", prompt: "Run the full test and production build pipeline; it may take several minutes.", required: ["exec_job_start", "exec_job_status", "exec_job_cancel"] },
  { id: "short-shell", prompt: "Run a short git status command in the repository.", required: ["exec_run"] },
  { id: "project-function", prompt: "Find the project and execute its declared automation function.", required: ["projects_list", "project_capabilities", "project_function_call"] },
  { id: "cloudflare-dns", prompt: "Update the Cloudflare DNS record after finding the correct zone.", required: ["cloudflare_zones_list", "cloudflare_dns_upsert"] },
  { id: "hostinger-dns", prompt: "Update a Hostinger DNS record for this domain.", required: ["hostinger_dns_upsert"] },
  { id: "dokploy", prompt: "List Dokploy projects and ensure the deployment project exists.", required: ["dokploy_projects_list", "dokploy_project_ensure"] },
  { id: "browser", prompt: "Check the Camoufox browser state and start it if it is stopped.", required: ["browser_status", "browser_power"] },
  { id: "screenshot", prompt: "Take a screenshot of the MSO desktop so I can inspect the UI.", required: ["screen_capture"] },
  { id: "memory", prompt: "Read my agent memory and remember this project convention for later sessions.", required: ["agent_memory_read", "agent_memory_remember"] },
  { id: "memory-retrieval", prompt: "Search my persistent memory for a prior deployment rule and inspect conflicting or temporal claims.", required: ["agent_memory_search"] },
  { id: "resume", prompt: "List previous agent sessions and resume the deployment session.", required: ["agent_sessions_list", "agent_session_resume"] },
  { id: "skills", prompt: "Find the best trusted skill for a repository security review and read its instructions.", required: ["skills_search", "skills_read"] },
  { id: "tool-forge", prompt: "Turn this repeated verified workflow into a Tool Forge candidate, evaluate it in the sandbox, review the candidate, then explicitly promote it.", required: ["tool_forge_candidates", "tool_forge_propose", "tool_forge_evaluate", "tool_forge_promote"] },
];

const toolShape = (tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema });
const bytes = (tools) => Buffer.byteLength(JSON.stringify(tools.map(toolShape)), "utf8");
const fullBytes = bytes(TOOLS);
let selectedBytes = 0, selectedCount = 0, requiredTotal = 0, requiredHit = 0, deterministic = true;
const rows = scenarios.map((scenario) => {
  const history = [{ role: "user", text: scenario.prompt }];
  const a = selectToolsForTurn(TOOLS, history);
  const b = selectToolsForTurn(TOOLS, history);
  deterministic &&= JSON.stringify(a.selectedNames) === JSON.stringify(b.selectedNames);
  const missing = scenario.required.filter((name) => !a.selectedNames.includes(name));
  requiredTotal += scenario.required.length; requiredHit += scenario.required.length - missing.length;
  const schemaBytes = bytes(a.tools); selectedBytes += schemaBytes; selectedCount += a.activeCount;
  return { id: scenario.id, required: scenario.required, missing, activeTools: a.activeCount, schemaBytes };
});

function hermesBaseline() {
  try {
    return JSON.parse(execFileSync("hermes", ["prompt-size", "--platform", "cli", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch { return null; }
}
function version(command) {
  try { return execFileSync(command, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0]; }
  catch { return null; }
}

const hermes = hermesBaseline();
const avgSelectedBytes = Math.round(selectedBytes / scenarios.length);
const avgActiveTools = Math.round((selectedCount / scenarios.length) * 10) / 10;
const routingRecall = requiredTotal ? requiredHit / requiredTotal : 0;
const memoryBenchmark = runMemoryRetrievalBenchmark();
const result = {
  generatedAt: new Date().toISOString(),
  providerNeutral: true,
  mso: {
    fullToolCount: TOOLS.length,
    fullToolSchemaBytes: fullBytes,
    averageActiveTools: avgActiveTools,
    averageActiveSchemaBytes: avgSelectedBytes,
    schemaReductionPct: Math.round((1 - avgSelectedBytes / fullBytes) * 1000) / 10,
    routingRecallPct: Math.round(routingRecall * 1000) / 10,
    deterministic,
    scenarios: rows,
    memory: memoryBenchmark,
  },
  hermes: hermes ? {
    version: version("hermes"), toolCount: hermes.tools?.count ?? null,
    toolSchemaBytes: hermes.tools?.json_bytes ?? null,
    systemPromptBytes: hermes.system_prompt?.bytes ?? null,
    skillsIndexBytes: hermes.skills_index?.bytes ?? null,
  } : { available: false },
  openclaw: {
    version: version("openclaw"),
    comparablePromptFootprintProbe: false,
    note: "Installed OpenClaw has no directly equivalent offline prompt-size probe exposed by this benchmark; do not infer an overall win from schema footprint alone.",
  },
};
result.gates = {
  routingRecall100: routingRecall === 1,
  deterministicRouting: deterministic,
  activeSchemaSmallerThanFull: avgSelectedBytes < fullBytes,
  beatsHermesToolSchemaBytes: Boolean(hermes?.tools?.json_bytes && avgSelectedBytes < hermes.tools.json_bytes),
  memoryRetrieval100: memoryBenchmark.retrieval.accuracyPct === 100,
  memoryTemporal100: memoryBenchmark.temporal.accuracyPct === 100,
  memoryConflict100: memoryBenchmark.conflict.accuracyPct === 100,
  memoryDeterministic: memoryBenchmark.deterministic,
};
result.passed = Object.values(result.gates).every(Boolean);

if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
else {
  console.log("MSO Cognitive Runtime benchmark");
  console.log(`  full catalog        ${TOOLS.length} tools · ${fullBytes.toLocaleString()} schema bytes`);
  console.log(`  active per turn     ${avgActiveTools} tools avg · ${avgSelectedBytes.toLocaleString()} bytes avg · ${result.mso.schemaReductionPct}% reduction`);
  console.log(`  routing             ${result.mso.routingRecallPct}% required-tool recall · deterministic=${deterministic}`);
  console.log(`  typed memory        ${memoryBenchmark.overallAccuracyPct}% retrieval/temporal/conflict · deterministic=${memoryBenchmark.deterministic}`);
  if (hermes?.tools) console.log(`  Hermes baseline     ${hermes.tools.count} tools · ${Number(hermes.tools.json_bytes).toLocaleString()} schema bytes`);
  else console.log("  Hermes baseline     unavailable");
  console.log(`  OpenClaw            ${result.openclaw.version || "unavailable"} · no comparable offline prompt-size probe`);
  for (const [gate, pass] of Object.entries(result.gates)) console.log(`  ${pass ? "PASS" : "FAIL"} ${gate}`);
  if (!result.passed) {
    for (const row of rows.filter((r) => r.missing.length)) console.log(`    ${row.id}: missing ${row.missing.join(", ")}`);
    process.exitCode = 1;
  }
}
