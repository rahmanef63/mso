import { resolveProjectHint } from "@/lib/host/projects-api";
import { isReplaySafeTool } from "@/lib/orchestration/automation";
import { ingestManualUserTest, searchRepoMemory, upsertRepoMemory } from "@/lib/orchestration/repo-memory";
import { readAutomationScript, writeAutomationScript } from "@/lib/orchestration/repo-memory-artifacts";
import { relatedRepoMemory, repoMemoryTimeline } from "@/lib/orchestration/repo-memory-insights";
import type { RepoMemoryKind, RepoMemoryLifecycle, RepoMemoryResult, RepoMemorySource } from "@/lib/orchestration/types";
import type { McpTool } from "./tool-kit";
import { opt, S, str } from "./tool-kit";
import { optionalStringList } from "./tools-learning-shared";

export const PROJECT_MEMORY_TOOLS: McpTool[] = [
  {
    name: "project_memory_search",
    description:
      "Read compact repo-local .agent memory through one token-efficient surface: ranked search, deterministic related-memory graph, or chronological timeline. Never reads raw chat transcripts.",
    scope: "read",
    annotations: { readOnlyHint: true, idempotentHint: true },
    limit: { key: "project.memory.search", max: 60, windowMs: 60_000 },
    inputSchema: S({
      project: { type: "string", description: "Validated project id, path, name or alias." },
      view: { type: "string", enum: ["search", "related", "timeline"], description: "Default search. related requires memory_id; timeline returns compact chronological events." },
      memory_id: { type: "string", description: "Memory id for view=related." },
      query: { type: "string", description: "Relevant terms for search/timeline." },
      kind: { type: "string", enum: ["task", "debug", "test", "decision", "failure"] },
      limit: { type: "number", minimum: 1, maximum: 20 },
      include_history: { type: "boolean", description: "Include superseded/archived records. Default false." },
    }, ["project"]),
    run: async (a) => {
      const project = await resolveProjectHint(str(a, "project"));
      if (!project) throw new Error(`project not found: ${String(a.project)}`);
      const kind = typeof a.kind === "string" ? a.kind as RepoMemoryKind : undefined;
      const view = opt(a, "view") ?? "search";
      const limit = typeof a.limit === "number" ? a.limit : undefined;
      if (view === "related") {
        const memoryId = opt(a, "memory_id");
        if (!memoryId) throw new Error("memory_id is required for view=related");
        const related = await relatedRepoMemory(project.path, memoryId, limit);
        if (!related) throw new Error("repo memory record not found");
        return { project: project.path, view, ...related };
      }
      if (view === "timeline") {
        return {
          project: project.path, view,
          events: await repoMemoryTimeline(project.path, { query: opt(a, "query"), limit, includeHistory: a.include_history === true }),
        };
      }
      return {
        project: project.path, view: "search",
        hits: await searchRepoMemory(project.path, {
          query: opt(a, "query"), kinds: kind ? [kind] : undefined, limit, includeHistory: a.include_history === true,
        }),
      };
    },
  },
  {
    name: "project_memory_upsert",
    description:
      "Create or update one compact repo-local task/debug/test/decision/failure memory. Use source=user-manual for the user's own test result so manual evidence can override an automated healthy assumption. Secrets are redacted before persistence.",
    scope: "write",
    annotations: { idempotentHint: false },
    limit: { key: "project.memory.write", max: 60, windowMs: 60_000 },
    audit: { action: "fs.write" as const, targetArg: "project" },
    inputSchema: S({
      project: { type: "string" }, id: { type: "string", description: "Existing memory id to update." },
      kind: { type: "string", enum: ["task", "debug", "test", "decision", "failure"] },
      title: { type: "string" }, summary: { type: "string" }, observation: { type: "string" },
      source: { type: "string", enum: ["agent", "system", "user-manual", "automation"] },
      result: { type: "string", enum: ["pass", "fail", "unknown"] },
      status: { type: "string", enum: ["active", "confirmed", "superseded", "archived"] },
      environment: { type: "string" }, commit: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 }, importance: { type: "number", minimum: 0, maximum: 1 },
      scope: { type: "array", items: { type: "string" }, maxItems: 40 },
      tags: { type: "array", items: { type: "string" }, maxItems: 40 },
      supersedes: { type: "array", items: { type: "string" }, maxItems: 40 },
    }, ["project", "kind", "title", "summary"]),
    run: async (a) => {
      const project = await resolveProjectHint(str(a, "project"));
      if (!project) throw new Error(`project not found: ${String(a.project)}`);
      const kind = str(a, "kind") as RepoMemoryKind;
      const source = (opt(a, "source") ?? "agent") as RepoMemorySource;
      const result = opt(a, "result") as RepoMemoryResult | undefined;
      if (kind === "test" && source === "user-manual" && (result === "pass" || result === "fail") && !opt(a, "id")) {
        return ingestManualUserTest(project.path, {
          observation: opt(a, "observation") ?? str(a, "summary"), result, title: str(a, "title"),
          environment: opt(a, "environment"), scope: optionalStringList(a.scope), tags: optionalStringList(a.tags), commit: opt(a, "commit"),
        });
      }
      return upsertRepoMemory(project.path, {
        id: opt(a, "id"), kind, title: str(a, "title"), summary: str(a, "summary"), observation: opt(a, "observation"),
        source, result, status: opt(a, "status") as RepoMemoryLifecycle | undefined, environment: opt(a, "environment"), commit: opt(a, "commit"),
        confidence: typeof a.confidence === "number" ? a.confidence : undefined, importance: typeof a.importance === "number" ? a.importance : undefined,
        scope: optionalStringList(a.scope), tags: optionalStringList(a.tags), supersedes: optionalStringList(a.supersedes),
      });
    },
  },
  {
    name: "project_script_run",
    description:
      "Execute one repo-local RASMIC automation script produced from a repeated stable recipe. Runtime re-validates every step and permits bounded read-only tools only; write/exec steps are refused even if a manifest was tampered. A successful candidate replay is promoted to tested.",
    scope: "write",
    annotations: { idempotentHint: false },
    limit: { key: "project.script.run", max: 30, windowMs: 60_000 },
    audit: { action: "fs.write" as const, targetArg: "project" },
    inputSchema: S({
      project: { type: "string", description: "Validated project id, path, name or alias that owns .agent/scripts." },
      script_id: { type: "string", description: "Exact script id returned by workflow_start automation metadata or workflow_finish." },
    }, ["project", "script_id"]),
    run: async (a, context) => {
      const project = await resolveProjectHint(str(a, "project"));
      if (!project) throw new Error(`project not found: ${String(a.project)}`);
      const scriptId = str(a, "script_id");
      const script = await readAutomationScript(project.path, scriptId);
      if (!script) throw new Error("automation script not found");
      if (script.steps.length > 12) throw new Error("automation script exceeds the 12-step replay bound");
      const { TOOLS_BY_NAME } = await import("./tools");
      const outputs: Array<{ tool: string; state: "completed"; result: string }> = [];
      const startedAt = Date.now();
      for (const step of script.steps) {
        if (!isReplaySafeTool(step.tool)) throw new Error(`automation step ${step.tool} is not replay-safe`);
        const tool = TOOLS_BY_NAME.get(step.tool);
        if (!tool || tool.scope !== "read") throw new Error(`automation step ${step.tool} is unavailable or not read-only`);
        const args = { ...(step.args ?? {}) };
        for (const required of tool.inputSchema.required ?? []) {
          if (args[required] == null) throw new Error(`automation step ${step.tool} is missing required input ${required}`);
        }
        const result = await tool.run(args, context);
        let compact: string;
        try { compact = JSON.stringify(result); } catch { compact = String(result); }
        if (compact.length > 1800) compact = `${compact.slice(0, 1800)}…`;
        outputs.push({ tool: step.tool, state: "completed", result: compact });
      }
      let status = script.status;
      let manifestPath: string | undefined;
      if (script.status === "candidate") {
        const tested = {
          ...script, status: "tested" as const, updatedAt: new Date().toISOString(),
          gates: { ...script.gates, tested: true },
        };
        manifestPath = await writeAutomationScript(project.path, tested, tested.id, false);
        status = "tested";
      }
      return {
        scriptId, status, success: true, stepsExecuted: outputs.length,
        durationMs: Date.now() - startedAt, manifestPath, outputs,
      };
    },
  },
];
