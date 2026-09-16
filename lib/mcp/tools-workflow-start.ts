import { ownedArtifactSession, prepareSessionArtifacts } from "@/lib/agent/artifact-session";
import { inspectProject, readProjectKnowledge, resolveProjectHint } from "@/lib/host/projects-api";
import { listLearnedRecipes, markRecipeUsed, startWorkflow, summarizeProjectContention } from "@/lib/workflow";
import { ensureLearnedWorkflowGraph, findMatchingWorkflowGraph } from "@/lib/workflow/graph-store";
import { searchSkillMemory } from "@/lib/skills/search";
import { progressiveVerification } from "@/lib/orchestration/automation";
import { routeIntentText } from "@/lib/orchestration/capability-catalog.mjs";
import { classifyTask, gitChangedPaths } from "@/lib/orchestration/classifier";
import { searchRepoMemory } from "@/lib/orchestration/repo-memory";
import { readAutomationScript } from "@/lib/orchestration/repo-memory-artifacts";
import type { WorkflowOrchestrationSnapshot } from "@/lib/orchestration/types";
import type { McpTool } from "./tool-kit";
import { opt, S, str } from "./tool-kit";
import { toolsetInfo } from "./toolset";
import { optionalStringList, visibleTools, WORKFLOW_PROGRESS_OUTPUT, workflowProgress } from "./tools-learning-shared";

export const WORKFLOW_START_TOOL: McpTool =
  {
    name: "workflow_start",
    description: "Start one isolated multi-step workflow, resolve project context, and search trusted skills/recipes/graphs. Use the returned workflow_id on later steps.",
    scope: "write",
    annotations: { idempotentHint: false },
    outputSchema: WORKFLOW_PROGRESS_OUTPUT,
    toStructuredContent: (result) => {
      if (!result || typeof result !== "object") return undefined;
      return workflowProgress((result as { workflow?: unknown }).workflow, true);
    },
    limit: { key: "workflow.memory", max: 30, windowMs: 60_000 },
    audit: { action: "workflow.start" as const, targetArg: "project" },
    inputSchema: S({
      intent: { type: "string", description: "Task in one sentence." },
      project: { type: "string", description: "Optional project id/path/name/alias." },
      constraints: { type: "string", description: "Optional constraints." },
      affected_paths: { type: "array", maxItems: 80, items: { type: "string" }, description: "Optional touched paths." },
      reserved_resources: { type: "array", maxItems: 40, items: { type: "string" }, description: "Optional shared resources." },
    }, ["intent"]),
    run: async (a, context) => {
      const actor = context.workflowActor ?? context.actor;
      const recipeOwner = context.recipeActor ?? context.actor;
      if (!actor || !recipeOwner) throw new Error("workflow memory needs an authenticated session and client");
      const artifactStorage = context.principal && context.sessionId ? await prepareSessionArtifacts(await ownedArtifactSession(context.principal,context.sessionId)) : undefined;
      const intent = str(a, "intent");
      const projectHint = opt(a, "project");
      const project = projectHint ? await resolveProjectHint(projectHint).catch(() => null) : null;
      const tools = await visibleTools(context.scope, context.toolProfile);
      const intentRoute = routeIntentText(intent);
      const routedTools = intentRoute.catalogMatched
        ? tools.filter((tool) => intentRoute.tools.includes(tool.name) || tool.name === "workflow_start")
        : tools;
      const search = await searchSkillMemory(intent, {
        topK: intentRoute.catalogMatched ? 5 : 7,
        recipeAccess: { actor: recipeOwner, scope: context.scope },
        toolDocs: routedTools.map((tool) => ({
          name: tool.name, description: tool.description, scope: tool.scope, inputSchema: tool.inputSchema,
        })),
      });
      const [repository, projectKnowledge] = project
        ? await Promise.all([
          inspectProject(project, { includeGitStatus: context.scope === "exec" }).catch(() => undefined),
          readProjectKnowledge(project.path).catch(() => undefined),
        ])
        : [undefined, undefined] as const;
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
      const memoryLimit = classification.memoryRelevance === "high" ? 5 : classification.memoryRelevance === "medium" ? 3 : 0;
      const repoMemory = project && memoryLimit > 0
        ? await searchRepoMemory(project.path, { query: intent, limit: memoryLimit }).catch(() => [])
        : [];
      const reusableScript = project && search.recommendedRecipe
        ? await readAutomationScript(project.path, `script_${search.recommendedRecipe.id}`).catch(() => null)
        : null;
      const projectKeys = [project?.id, project?.path, project?.name, projectHint].filter((value): value is string => Boolean(value));
      let graphAutomation = await findMatchingWorkflowGraph(recipeOwner, intent, projectKeys).catch(() => null);
      if (!graphAutomation && search.recommendedRecipe) {
        const fullRecipe = (await listLearnedRecipes({ actor: recipeOwner, scope: context.scope }))
          .find((recipe) => recipe.id === search.recommendedRecipe?.id);
        if (fullRecipe) graphAutomation = await ensureLearnedWorkflowGraph(fullRecipe).catch(() => null);
      }
      const recipePlan = search.recommendedRecipe ? {
        id: search.recommendedRecipe.id,
        attempts: search.recommendedRecipe.attempts ?? 0,
        successRate: search.recommendedRecipe.successRate ?? 0,
        maturity: search.recommendedRecipe.maturity ?? "candidate",
        steps: (search.recommendedRecipe.steps ?? []).slice(0, 12).map((step) => ({
          tool: step.tool, target: step.target, args: step.args,
        })),
        instruction: reusableScript
          ? (reusableScript.status === "tested" ? "Prefer the tested script path below when current evidence is compatible." : "A script candidate exists; verify it before treating the route as tested.")
          : search.recommendedRecipe.maturity === "verified"
            ? "Prefer this verified bounded route when current evidence and tool availability remain compatible."
            : "This is a candidate route from repeated successes. Use it as a planning shortcut, but verify the current task independently.",
      } : undefined;
      const compactSearch = {
        engine: search.engine,
        query: search.query,
        catalog: search.catalog,
        hits: search.hits.slice(0, 5).map((hit) => ({
          kind: hit.kind, id: hit.id, name: hit.name, score: hit.score,
          description: hit.description.slice(0, 600), source: hit.source, trust: hit.trust, scope: hit.scope, project: hit.project,
          successRate: hit.successRate, attempts: hit.attempts, maturity: hit.maturity, missingTools: hit.missingTools, contract: hit.contract,
        })),
        recommendedRecipe: search.recommendedRecipe ? {
          ...search.recommendedRecipe,
          description: search.recommendedRecipe.description.slice(0, 800),
          steps: search.recommendedRecipe.steps?.slice(0, 12),
        } : undefined,
      };
      const contextEstimateTokens = Math.ceil([
        intent,
        ...(projectKnowledge?.content ? [projectKnowledge.content] : []),
        ...repoMemory.map((hit) => `${hit.record.title} ${hit.record.summary}`),
        compactSearch.recommendedRecipe?.description ?? "",
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
      const toolset = toolsetInfo(tools, context.scope, context.toolProfile);
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
      if (search.recommendedRecipe) {
        await markRecipeUsed(search.recommendedRecipe.id, { actor: recipeOwner, scope: context.scope }).catch(() => undefined);
      }
      return {
        ...started,
        bootstrap: {
          ready: true,
          artifacts: artifactStorage,
          toolset,
          project: project ?? (projectHint ? { hint: projectHint, matchedBy: "unresolved" } : undefined),
          repository,
          projectKnowledge: projectKnowledge?.exists ? {
            content: projectKnowledge.content, path: projectKnowledge.path, bytes: projectKnowledge.bytes, sha256: projectKnowledge.sha256,
          } : undefined,
          discovery,
          orchestration: {
            classification,
            verificationPlan: progressiveVerification(classification.risk),
            recipe: recipePlan,
            automation: {
              ...(graphAutomation ? {
                graph: { id: graphAutomation.id, name: graphAutomation.name, status: graphAutomation.status, revision: graphAutomation.revision, provenance: graphAutomation.metadata.provenance },
                graphInstruction: graphAutomation.status === "active"
                  ? "A private workflow graph already matches this task. Prefer it before replanning when current evidence is compatible."
                  : "A private learned/user draft matches this task. Inspect it before activation/run; normal authorization still applies.",
              } : {}),
              ...(reusableScript ? {
                scriptId: reusableScript.id, status: reusableScript.status,
                instruction: reusableScript.status === "tested"
                  ? "Prefer project_script_run before replanning this deterministic repeated route."
                  : "Run project_script_run once to verify this bounded candidate; success promotes it to tested.",
              } : {}),
            },
            memory: repoMemory.map((hit) => ({
              id: hit.record.id, kind: hit.record.kind, title: hit.record.title, summary: hit.record.summary,
              status: hit.record.status, score: hit.score, lastVerified: hit.record.lastVerified,
            })),
          },
          trace: [
            `[MSO] connected · ${context.scope} scope · ${toolset.toolCount} tools · ${toolset.version}/${toolset.hash}`,
            project ? `[Project] ${project.hint} → ${project.path} (${project.matchedBy})` : `[Project] ${projectHint ?? "not specified"}`,
            `[Risk] ${classification.risk} · ${classification.complexity} complexity · ${classification.contention} contention · ${classification.isolation}`,
            `[Catalog] ${intentRoute.catalogMatched ? intentRoute.routeIds.join(", ") : "semantic fallback"} · ${routedTools.length}/${tools.length} tool docs scored`,
            `[Knowledge] ${projectKnowledge?.exists ? `${projectKnowledge.bytes} bytes always-on` : "not configured"}`,
            `[Memory] ${repoMemory.length} repo-local hit(s) · ${search.recommendedRecipe ? `${search.recommendedRecipe.maturity ?? "candidate"} recipe available` : "no reusable recipe selected"} · ~${contextEstimateTokens} context tokens`,
            ...(recipePlan ? [`[Recipe] ${recipePlan.maturity} · ${recipePlan.attempts} attempts · ${recipePlan.successRate}% success · ${recipePlan.steps.length} reusable step(s)`] : []),
            ...(graphAutomation ? [`[Workflow graph] ${graphAutomation.status} · ${graphAutomation.name} · ${graphAutomation.metadata.provenance ?? "private"}`] : [`[Workflow graph] no matching private graph; successful completion will seed a learned draft`]),
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
        search: compactSearch,
        instruction: "Use the smallest useful returned memory context and any safe recipe. Follow the risk/isolation policy, verify progressively, then call workflow_finish with evidence.",
      };
    },
  };
