import { inspectProject, resolveProjectHint } from "@/lib/host";
import { activeWorkflowForActor, cancelWorkflow, finishWorkflow, markRecipeUsed, startWorkflow, summarizeProjectContention } from "@/lib/skills/memory";
import { searchSkillMemory } from "@/lib/skills/search";
import { assessAutomationPromotion, buildAutomationScriptManifest, isReplaySafeTool, progressiveVerification } from "@/lib/orchestration/automation";
import { classifyTask, gitChangedPaths } from "@/lib/orchestration/classifier";
import { buildEvidenceReceipt, validateEvidenceReceipt } from "@/lib/orchestration/evidence";
import { ingestManualUserTest, readAutomationScript, searchRepoMemory, upsertRepoMemory, writeAutomationScript, writeEvidenceReceipt, writePortableRecipe } from "@/lib/orchestration/repo-memory";
import type { EvidenceInput, RepoMemoryKind, RepoMemoryLifecycle, RepoMemoryResult, RepoMemorySource, WorkflowOrchestrationSnapshot } from "@/lib/orchestration/types";
import { allows } from "./scope";
import { type McpTool, str, opt, S } from "./tool-kit";
import { toolsetInfo } from "./toolset";
import { WORKFLOW_PROGRESS_URI } from "./ui-resources";

function optionalStringList(value: unknown, max = 40): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, max) : [];
}

function evidenceInput(value: unknown): EvidenceInput | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const out: EvidenceInput = {
    ...(typeof row.environment === "string" && row.environment ? { environment: row.environment } : {}),
    claims: optionalStringList(row.claims), tests: optionalStringList(row.tests), build: optionalStringList(row.build),
    deployment: optionalStringList(row.deployment), health: optionalStringList(row.health), artifacts: optionalStringList(row.artifacts),
    manualVerification: optionalStringList(row.manual_verification), knownRisks: optionalStringList(row.known_risks),
  };
  return out;
}

function evidenceSchema() {
  const list = { type: "array", maxItems: 40, items: { type: "string" } };
  return {
    type: "object",
    description: "Structured verification evidence. Required for success on new HIGH-risk workflows.",
    properties: {
      environment: { type: "string" }, claims: list, tests: list, build: list, deployment: list, health: list, artifacts: list,
      manual_verification: list, known_risks: list,
    },
    additionalProperties: false,
  };
}

const visibleTools = async (scope: "read" | "write" | "exec"): Promise<McpTool[]> => {
  const { TOOLS } = await import("./tools");
  return TOOLS.filter((tool) => allows(scope, tool.scope));
};

const WORKFLOW_PROGRESS_OUTPUT = {
  type: "object",
  properties: {
    active: { type: "boolean" },
    workflowId: { type: "string" },
    intent: { type: "string" },
    project: { type: "string" },
    startedAt: { type: "string" },
    elapsedMs: { type: "number" },
    stepCount: { type: "number" },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tool: { type: "string" },
          state: { type: "string", enum: ["completed", "failed", "denied", "rate_limited", "invalid_args"] },
          durationMs: { type: "number" },
          ts: { type: "string" },
        },
        required: ["tool", "state", "ts"],
        additionalProperties: false,
      },
    },
  },
  required: ["active", "workflowId", "stepCount", "steps"],
  additionalProperties: false,
} as const;

type WorkflowProgressStep = {
  tool: string;
  state: "completed" | "failed" | "denied" | "rate_limited" | "invalid_args";
  durationMs?: number;
  ts: string;
};

function projectLabel(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const label = normalized.split("/").filter(Boolean).at(-1) ?? normalized;
  return label.slice(0, 120) || undefined;
}

function workflowSteps(value: unknown): WorkflowProgressStep[] {
  if (!Array.isArray(value)) return [];
  const out: WorkflowProgressStep[] = [];
  for (const candidate of value.slice(-8)) {
    if (!candidate || typeof candidate !== "object") continue;
    const step = candidate as Record<string, unknown>;
    const state = step.state;
    if (typeof step.tool !== "string" || typeof step.ts !== "string") continue;
    if (state !== "completed" && state !== "failed" && state !== "denied" && state !== "rate_limited" && state !== "invalid_args") continue;
    out.push({
      tool: step.tool.slice(0, 100),
      state,
      ...(typeof step.durationMs === "number" && Number.isFinite(step.durationMs)
        ? { durationMs: Math.max(0, step.durationMs) }
        : {}),
      ts: step.ts,
    });
  }
  return out;
}

function workflowProgress(value: unknown, active: boolean): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const workflow = value as Record<string, unknown>;
  if (typeof workflow.id !== "string" || !workflow.id) return undefined;
  const allSteps = Array.isArray(workflow.steps) ? workflow.steps : [];
  const startedAt = typeof workflow.startedAt === "string" ? workflow.startedAt : undefined;
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  const label = projectLabel(workflow.project);
  return {
    active,
    workflowId: workflow.id,
    ...(typeof workflow.intent === "string" && workflow.intent ? { intent: workflow.intent.slice(0, 1000) } : {}),
    ...(label ? { project: label } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(Number.isFinite(started) ? { elapsedMs: Math.max(0, Date.now() - started) } : {}),
    stepCount: allSteps.length,
    steps: workflowSteps(allSteps),
  };
}

export const LEARNING_TOOLS: McpTool[] = [
  {
    name: "workflow_start",
    description:
      "The ONE startup call for a multi-step task. It starts the workflow, searches trusted skills and prior recipes, " +
      "resolves project aliases, reports the current toolset/version, and inspects repository context when available. " +
      "Do not call skills_search first for the same task; this already includes it. Multiple conversations may start isolated workflows on one token; correlate every later step with the returned workflow_id.",
    scope: "write",
    annotations: { idempotentHint: false },
    outputSchema: WORKFLOW_PROGRESS_OUTPUT,
    toStructuredContent: (result) => {
      if (!result || typeof result !== "object") return undefined;
      return workflowProgress((result as { workflow?: unknown }).workflow, true);
    },
    meta: {
      ui: { resourceUri: WORKFLOW_PROGRESS_URI, visibility: ["model", "app"] },
      "openai/outputTemplate": WORKFLOW_PROGRESS_URI,
      "openai/toolInvocation/invoking": "Starting MSO workflow…",
      "openai/toolInvocation/invoked": "MSO workflow ready",
    },
    limit: { key: "workflow.memory", max: 30, windowMs: 60_000 },
    audit: { action: "workflow.start" as const, targetArg: "project" },
    inputSchema: S({
      intent: { type: "string", description: "The user's task in one complete sentence." },
      project: { type: "string", description: "Optional project id from projects_list, absolute path, name or alias (e.g. os-vps, mso, projects/mso)." },
      constraints: { type: "string", description: "Optional important constraints, such as no downtime or WebP only." },
      affected_paths: { type: "array", maxItems: 80, items: { type: "string" }, description: "Optional expected files/directories this workflow may touch; used for pre-merge collision detection." },
      reserved_resources: { type: "array", maxItems: 40, items: { type: "string" }, description: "Optional shared resources such as port:4173, database:development, deployment:staging, queue:name." },
    }, ["intent"]),
    run: async (a, context) => {
      const actor = context.workflowActor ?? context.actor;
      const recipeOwner = context.recipeActor ?? context.actor;
      if (!actor || !recipeOwner) throw new Error("workflow memory needs an authenticated session and client");
      const intent = str(a, "intent");
      const projectHint = opt(a, "project");
      const project = projectHint ? await resolveProjectHint(projectHint).catch(() => null) : null;
      const tools = await visibleTools(context.scope);
      // Complete every fallible read-only preflight before allocating the run id.
      // A failed skill scan or repo inspection must not leave a run the client never
      // received an id for and therefore cannot close.
      const search = await searchSkillMemory(intent, {
        topK: 8,
        recipeAccess: { actor: recipeOwner, scope: context.scope },
        toolDocs: tools.map((tool) => ({
          name: tool.name, description: tool.description, scope: tool.scope, inputSchema: tool.inputSchema,
        })),
      });
      const repository = project
        ? await inspectProject(project, { includeGitStatus: context.scope === "exec" }).catch(() => undefined)
        : undefined;
      const changedPaths = gitChangedPaths(repository?.git.changes ?? []);
      const affectedPaths = optionalStringList(a.affected_paths, 80);
      const reservedResources = optionalStringList(a.reserved_resources, 40);
      const contention = project
        ? await summarizeProjectContention(project.path, affectedPaths, reservedResources)
        : { activeWorkflowCount: 0, conflictingWorkflowCount: 0, overlappingPaths: [], overlappingResources: [] };
      const activeProjectWorkflows = contention.activeWorkflowCount;
      const classification = classifyTask({
        intent, constraints: opt(a, "constraints"), scope: context.scope, changedPaths, activeProjectWorkflows,
        collisionPaths: contention.overlappingPaths, collisionResources: contention.overlappingResources,
      });
      const repoMemory = project && classification.memoryRelevance !== "low"
        ? await searchRepoMemory(project.path, { query: intent, limit: 7 }).catch(() => [])
        : [];
      const reusableScript = project && search.recommendedRecipe
        ? await readAutomationScript(project.path, `script_${search.recommendedRecipe.id}`).catch(() => null)
        : null;
      const contextEstimateTokens = Math.ceil([
        intent,
        ...repoMemory.map((hit) => `${hit.record.title} ${hit.record.summary}`),
        search.recommendedRecipe?.description ?? "",
      ].join("\n").length / 4);
      const orchestration: WorkflowOrchestrationSnapshot = {
        ...classification,
        ...(repository?.git.head?.sha ? { baseCommit: repository.git.head.sha } : {}),
        ...(repository?.git.branch ? { baseBranch: repository.git.branch } : {}),
        ...(project?.path ? { workspacePath: project.path } : {}),
        changedPaths, affectedPaths, reservedResources,
        overlappingPaths: contention.overlappingPaths, overlappingResources: contention.overlappingResources,
        activeProjectWorkflows, conflictingWorkflowCount: contention.conflictingWorkflowCount,
        memoryHits: repoMemory.length + (search.recommendedRecipe ? 1 : 0),
        contextEstimateTokens,
        cleanupState: classification.isolation === "direct" ? "not-required" : "pending",
        ...(search.recommendedRecipe ? { recipeUsed: search.recommendedRecipe.id } : {}),
        createdAt: new Date().toISOString(),
      };
      const toolset = toolsetInfo(tools, context.scope);
      // Discovery incompleteness travels WITH the bootstrap. A model told "here is the
      // project and the trusted skills" will not re-check whether the scan covered the
      // whole box; if it did not, it has to be told in the same breath.
      const discovery = {
        catalog: search.catalog,
        complete: !search.catalog.truncated,
      };
      const started = await startWorkflow({
        actor,
        scope: context.scope,
        intent,
        project: project?.path ?? projectHint,
        constraints: opt(a, "constraints"),
        orchestration,
      });
      // Recommendation telemetry is useful, but failure to persist lastUsedAt must
      // never turn a successfully-created workflow into an opaque tool failure.
      if (search.recommendedRecipe) {
        await markRecipeUsed(search.recommendedRecipe.id, { actor: recipeOwner, scope: context.scope }).catch(() => undefined);
      }
      return {
        ...started,
        bootstrap: {
          ready: true,
          toolset,
          project: project ?? (projectHint ? { hint: projectHint, matchedBy: "unresolved" } : undefined),
          repository,
          discovery,
          orchestration: {
            classification,
            verificationPlan: progressiveVerification(classification.risk),
            automation: reusableScript ? {
              scriptId: reusableScript.id, status: reusableScript.status,
              instruction: reusableScript.status === "tested"
                ? "Prefer project_script_run before replanning this deterministic repeated route."
                : "Run project_script_run once to verify this bounded candidate; success promotes it to tested.",
            } : undefined,
            memory: repoMemory.map((hit) => ({
              id: hit.record.id, kind: hit.record.kind, title: hit.record.title, summary: hit.record.summary,
              status: hit.record.status, score: hit.score, lastVerified: hit.record.lastVerified,
            })),
          },
          trace: [
            `[MSO] connected · ${context.scope} scope · ${toolset.toolCount} tools · ${toolset.version}/${toolset.hash}`,
            project ? `[Project] ${project.hint} → ${project.path} (${project.matchedBy})` : `[Project] ${projectHint ?? "not specified"}`,
            `[Risk] ${classification.risk} · ${classification.complexity} complexity · ${classification.contention} contention · ${classification.isolation}`,
            `[Memory] ${repoMemory.length} repo-local hit(s) · ${search.recommendedRecipe ? "recipe available" : "no verified recipe selected"} · ~${contextEstimateTokens} context tokens`,
            ...(reusableScript ? [`[Automation] ${reusableScript.status} script ${reusableScript.id} available`] : []),
            ...(contention.conflictingWorkflowCount ? [`[Collision] ${contention.conflictingWorkflowCount} workflow(s) overlap declared paths/resources`] : []),
            ...(discovery.complete ? [] : [`[Discovery] partial scan — ${search.catalog.truncationReasons.join(", ")}; do not conclude something is absent`]),
            "[Plan] classify → retrieve minimal memory → isolate if required → execute → progressive verify → learn → workflow_finish",
          ],
          policy: {
            simple: "LOW-risk work may run directly with a targeted check; branch/worktree is a safety tool, not a goal.",
            isolation: classification.risk === "high"
              ? "HIGH-risk work requires isolation plus explicit verification before integration."
              : classification.isolation === "optional-worktree"
                ? "Use a short-lived branch/worktree when it reduces current contention."
                : "Direct work is acceptable when scope remains isolated.",
            repository: "For short repository-wide search/git checks use one narrow exec_run batch; for tests/builds that may exceed 30 seconds use exec_job_start and poll exec_job_status.",
            progress: "Show only high-level feature/tool badges and outcomes; never private chain-of-thought.",
            manualUserTest: "When the user reports a manual test result, persist it with project_memory_upsert source=user-manual; a failed manual test outranks an automated healthy assumption.",
            finish: "Call workflow_finish with this exact workflow id only after independent verification; new HIGH-risk workflows require structured evidence. Use workflow_cancel for an abandoned run.",
          },
        },
        search,
        instruction: "Use the smallest useful returned memory context and any safe recipe. Follow the risk/isolation policy, verify progressively, then call workflow_finish with evidence.",
      };
    },
  },
  {
    name: "workflow_status",
    description:
      "Return a redacted live status snapshot for one workflow. This tool exists for the MSO ChatGPT progress widget: it exposes only workflow identity, timing and high-level tool outcomes, never tool arguments, command strings, file contents or credentials.",
    scope: "read",
    annotations: { readOnlyHint: true, idempotentHint: true },
    outputSchema: WORKFLOW_PROGRESS_OUTPUT,
    meta: {
      ui: { visibility: ["app"] },
      "openai/widgetAccessible": true,
    },
    limit: { key: "workflow.status", max: 30, windowMs: 60_000 },
    inputSchema: S({
      workflow_id: { type: "string", description: "Exact id returned by workflow_start." },
    }),
    run: async (a, context) => {
      const workflowId = str(a, "workflow_id");
      const workflow = await activeWorkflowForActor(context.workflowActor ?? context.actor, workflowId);
      if (!workflow) {
        return { active: false, workflowId, stepCount: 0, steps: [] };
      }
      return workflowProgress(workflow, true)!;
    },
  },
  {
    name: "workflow_cancel",
    description:
      "Cancel one exact active workflow without saving a learned recipe. Use this only when the task is being abandoned or the prior run was interrupted; " +
      "workflow_id is required so a different conversation cannot be cancelled accidentally.",
    scope: "write",
    annotations: { idempotentHint: false },
    limit: { key: "workflow.memory", max: 30, windowMs: 60_000 },
    audit: { action: "workflow.cancel" as const, targetArg: "workflow_id" },
    inputSchema: S({
      workflow_id: { type: "string", description: "Exact id returned by workflow_start." },
      reason: { type: "string", description: "Optional concise reason; no secrets or file contents." },
    }, ["workflow_id"]),
    run: (a, context) => cancelWorkflow({
      actor: context.workflowActor ?? context.actor,
      workflowId: str(a, "workflow_id"),
      reason: opt(a, "reason"),
    }),
  },
  {
    name: "workflow_finish",
    description:
      "Finish one exact learned workflow after verification. workflow_id is required so another conversation using the same token cannot close the wrong run. " +
      "MSO saves a redacted Evidence Receipt, task/failure memory, recipe quality, and safe automation-promotion metadata. New HIGH-risk workflows cannot claim success without explicit evidence.",
    scope: "write",
    annotations: { idempotentHint: false },
    limit: { key: "workflow.memory", max: 30, windowMs: 60_000 },
    audit: { action: "workflow.finish" as const, targetArg: "workflow_id" },
    inputSchema: S({
      workflow_id: { type: "string", description: "Exact id returned by workflow_start." },
      summary: { type: "string", description: "Concise outcome and verification result; no secrets." },
      success: { type: "boolean", description: "True only after the requested result is verified." },
      evidence: evidenceSchema(),
    }, ["workflow_id", "summary", "success"]),
    run: async (a, context) => {
      const actor = context.workflowActor ?? context.actor;
      const workflowId = str(a, "workflow_id");
      const summary = str(a, "summary");
      const success = a.success === true;
      const workflow = await activeWorkflowForActor(actor, workflowId);
      if (!workflow) throw new Error("workflow_id was not found for this MSO session");
      const project = workflow.project ? await resolveProjectHint(workflow.project).catch(() => null) : null;
      const finalRepository = project
        ? await inspectProject(project, { includeGitStatus: context.scope === "exec" }).catch(() => undefined)
        : undefined;
      const risk = workflow.orchestration?.risk ?? classifyTask({
        intent: workflow.intent, constraints: workflow.constraints, scope: context.scope,
      }).risk;
      const suppliedEvidence = evidenceInput(a.evidence);
      const receipt = buildEvidenceReceipt({
        workflow, summary, success, evidence: suppliedEvidence,
        finalCommit: finalRepository?.git.head?.sha,
      });
      const validation = validateEvidenceReceipt(receipt, { success, risk });
      // Backward compatibility: only workflows created with RASMIC metadata get the new
      // hard gate. Legacy in-flight workflows can still close under their old contract.
      if (workflow.orchestration && !validation.valid) throw new Error(validation.errors.join("; "));

      const finished = await finishWorkflow({
        actor, recipeActor: context.recipeActor ?? context.actor, workflowId, summary, success,
      });
      const automation = assessAutomationPromotion(finished.recipe);
      const persistenceWarnings: string[] = [];
      let evidencePath: string | undefined;
      let taskMemoryId: string | undefined;
      let scriptPath: string | undefined;
      const explicitEvidence = Boolean(suppliedEvidence && [
        suppliedEvidence.tests, suppliedEvidence.build, suppliedEvidence.deployment,
        suppliedEvidence.health, suppliedEvidence.artifacts, suppliedEvidence.manualVerification,
        suppliedEvidence.knownRisks,
      ].some((items) => Array.isArray(items) && items.length > 0));
      const shouldPersistEvidence = risk !== "low" || !success || explicitEvidence;
      const shouldPersistTaskMemory = shouldPersistEvidence || workflow.orchestration?.memoryRelevance !== "low";
      const memoryScope = [...new Set([
        ...(workflow.orchestration?.affectedPaths ?? []),
        ...(workflow.orchestration?.changedPaths ?? []),
      ])];

      if (project) {
        try {
          if (shouldPersistEvidence) evidencePath = await writeEvidenceReceipt(project.path, receipt);
          if (shouldPersistTaskMemory) {
            const taskMemory = await upsertRepoMemory(project.path, {
            kind: "task",
            title: `${success ? "Completed" : "Failed"}: ${workflow.intent.slice(0, 120)}`,
            summary,
            source: "system",
            result: success ? "pass" : "fail",
            status: success ? "confirmed" : "active",
            confidence: success ? 0.9 : 1,
            importance: risk === "high" ? 0.9 : risk === "medium" ? 0.7 : 0.5,
            lastVerified: success ? receipt.createdAt : undefined,
            scope: memoryScope,
            tags: ["workflow", risk, workflow.orchestration?.complexity ?? "unknown"],
            commit: receipt.finalCommit,
            environment: receipt.environment,
            happened: summary,
            ...(success ? { worked: summary } : { failed: summary }),
            learned: success ? "Result is backed by the attached Evidence Receipt." : "Do not treat this workflow as healthy until the failure is resolved and re-verified.",
            reuse: automation.stage === "verified" ? "A verified reusable recipe exists for similar work; prefer it before replanning from scratch." : "Retrieve this task memory when similar scope is attempted again.",
            });
            taskMemoryId = taskMemory.id;
          }
          if (!success) {
            await upsertRepoMemory(project.path, {
              kind: "failure", title: `Workflow failure: ${workflow.intent.slice(0, 120)}`, summary, source: "system",
              result: "fail", status: "active", confidence: 1, importance: 0.9,
              scope: memoryScope, tags: ["workflow-failure", risk], commit: receipt.finalCommit,
              failed: summary, reuse: "Check this failure before repeating the same approach.",
            });
          }
          if (automation.stage !== "observed") {
            await writePortableRecipe(project.path, {
              schemaVersion: 1, id: finished.recipe.id, intent: finished.recipe.intent, summary: finished.recipe.summary,
              stage: automation.stage, attempts: finished.recipe.attempts, successes: finished.recipe.successes, failures: finished.recipe.failures,
              successRate: automation.successRate, bestSteps: finished.recipe.bestSteps, quality: finished.recipe.quality, updatedAt: finished.recipe.updatedAt,
            }, finished.recipe.id);
          }
          if (automation.scriptCandidate) {
            const script = buildAutomationScriptManifest(finished.recipe, { tested: false });
            scriptPath = await writeAutomationScript(project.path, script, script.id, true);
          }
        } catch (error) {
          persistenceWarnings.push(error instanceof Error ? error.message : String(error));
        }
      }

      return {
        ...finished,
        evidence: { receipt, valid: validation.valid, errors: validation.errors, path: evidencePath },
        automation,
        metrics: {
          toolCalls: workflow.steps.length,
          executionDurationMs: finished.currentDurationMs,
          retries: finished.recipe.lastQuality?.retries ?? 0,
          memoryHits: workflow.orchestration?.memoryHits ?? 0,
          contextEstimateTokens: workflow.orchestration?.contextEstimateTokens ?? 0,
          recipeUsed: Boolean(workflow.orchestration?.recipeUsed),
          recipeStage: automation.stage,
          scriptCandidateCreated: Boolean(scriptPath),
        },
        repoMemory: { taskMemoryId, scriptPath, warnings: persistenceWarnings },
      };
    },
  },
  {
    name: "project_memory_search",
    description:
      "Search compact repo-local .agent memory for the smallest useful context. Ranks confirmed/current memory above stale or superseded history and never reads raw chat transcripts.",
    scope: "read",
    annotations: { readOnlyHint: true, idempotentHint: true },
    limit: { key: "project.memory.search", max: 60, windowMs: 60_000 },
    inputSchema: S({
      project: { type: "string", description: "Validated project id, path, name or alias." },
      query: { type: "string", description: "What prior task/debug/test/decision/failure context is relevant." },
      kind: { type: "string", enum: ["task", "debug", "test", "decision", "failure"] },
      limit: { type: "number", minimum: 1, maximum: 20 },
      include_history: { type: "boolean", description: "Include superseded/archived records. Default false." },
    }, ["project"]),
    run: async (a) => {
      const project = await resolveProjectHint(str(a, "project"));
      if (!project) throw new Error(`project not found: ${String(a.project)}`);
      const kind = typeof a.kind === "string" ? a.kind as RepoMemoryKind : undefined;
      return {
        project: project.path,
        hits: await searchRepoMemory(project.path, {
          query: opt(a, "query"), kinds: kind ? [kind] : undefined,
          limit: typeof a.limit === "number" ? a.limit : undefined, includeHistory: a.include_history === true,
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
