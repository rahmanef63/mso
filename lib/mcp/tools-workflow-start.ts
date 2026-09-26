import { ownedArtifactSession, prepareSessionArtifacts } from "@/lib/agent/artifact-session";
import { inspectProject, readProjectKnowledge, resolveProjectHint } from "@/lib/host/projects-api";
import { discardPreparedProjectWorktree, prepareProjectWorktree } from "@/lib/host/project-worktree";
import { listLearnedRecipes, markRecipeRecommended, startWorkflow, summarizeProjectContention } from "@/lib/workflow";
import { ensureLearnedWorkflowGraph, findMatchingWorkflowGraph } from "@/lib/workflow/graph-store";
import { progressiveVerification } from "@/lib/orchestration/automation";
import { routeIntentText } from "@/lib/orchestration/capability-catalog.mjs";
import { classifyTask, gitChangedPaths } from "@/lib/orchestration/classifier";
import { searchRepoMemory } from "@/lib/orchestration/repo-memory";
import { readAutomationScript } from "@/lib/orchestration/repo-memory-artifacts";
import type { WorkflowOrchestrationSnapshot } from "@/lib/orchestration/types";
import { type McpTool, opt, S, str } from "./tool-kit";
import { toolsetInfo } from "./toolset";
import { optionalStringList, visibleTools } from "./tools-learning-shared";
import { WORKFLOW_START_OUTPUT, workflowStartProjection } from "./tools-workflow-start-output";
import { workflowStartAgentMemory } from "./workflow-start-memory";
import { AGENT_BOOTSTRAP_SKILL, workflowOrientation, workflowStartPolicy } from "./instructions";
import { workflowStartCandidateContext } from "./workflow-start-candidates";
export const WORKFLOW_START_TOOL: McpTool = {
    name: "workflow_start",
    description: "First call for multi-step work: resolve project context, search trusted skills/recipes/graphs, and return workflow_id. Carry that exact id on later steps. Read official skill mso-agent-bootstrap when learning the MSO map.",
    chatgptDescription: "First call for multi-step work; keep workflow_id.",
    scope: "write",
    annotations: { idempotentHint: false },
    outputSchema: WORKFLOW_START_OUTPUT,
    toStructuredContent: workflowStartProjection,
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
      const actor = context.workflowActor ?? context.actor, recipeOwner = context.recipeActor ?? context.actor;
      if (!actor || !recipeOwner) throw new Error("workflow memory needs an authenticated session and client");
      const artifactStorage = context.principal && context.sessionId ? await prepareSessionArtifacts(await ownedArtifactSession(context.principal,context.sessionId)) : undefined;
      const intent = str(a, "intent");
      const agentMemory = await workflowStartAgentMemory(context, intent);
      const projectHint = opt(a, "project");
      const project = projectHint ? await resolveProjectHint(projectHint).catch(() => null) : null;
      const tools = await visibleTools(context.scope, context.toolProfile);
      const intentRoute = routeIntentText(intent);
      const routedTools = intentRoute.catalogMatched ? tools.filter((tool) => intentRoute.tools.includes(tool.name) || tool.name === "workflow_start") : tools;
      const [repository, projectKnowledge] = project ? await Promise.all([inspectProject(project, { includeGitStatus: context.scope === "exec" }).catch(() => undefined),
        readProjectKnowledge(project.path).catch(() => undefined)]) : [undefined, undefined] as const;
      const changedPaths = gitChangedPaths(repository?.git.changes ?? []);
      const { search, reusablePool, candidateSearch, candidatePool } = await workflowStartCandidateContext({
        intent, recipeOwner, scope: context.scope, project, projectHint, repository,
        catalogMatched: intentRoute.catalogMatched, routedTools,
      });
      const affectedPaths = optionalStringList(a.affected_paths, 80), reservedResources = optionalStringList(a.reserved_resources, 40);
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
        ? await searchRepoMemory(project.path, { query: intent, limit: memoryLimit }).catch(() => []) : [];
      const reusableScript = project && search.recommendedRecipe
        ? await readAutomationScript(project.path, `script_${search.recommendedRecipe.id}`).catch(() => null)
        : null;
      const projectKeys = [project?.id, project?.path, project?.name, projectHint].filter((value): value is string => Boolean(value));
      let graphAutomation = await findMatchingWorkflowGraph(recipeOwner, intent, projectKeys).catch(() => null);
      if (!graphAutomation && search.recommendedRecipe) {
        const fullRecipe = (await listLearnedRecipes({ actor: recipeOwner, scope: context.scope })).find((recipe) => recipe.id === search.recommendedRecipe?.id);
        if (fullRecipe) graphAutomation = await ensureLearnedWorkflowGraph(fullRecipe).catch(() => null);
      }
      const recipePlan = search.recommendedRecipe ? {
        id: search.recommendedRecipe.id,
        attempts: search.recommendedRecipe.attempts ?? 0,
        successRate: search.recommendedRecipe.successRate ?? 0,
        maturity: search.recommendedRecipe.maturity ?? "candidate",
        steps: (search.recommendedRecipe.steps ?? []).slice(0, 12).map((step) => (
          { tool: step.tool, target: step.target, args: step.args })),
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
        ...agentMemory.map((hit) => `${hit.key} ${hit.value}`),
        ...repoMemory.map((hit) => `${hit.record.title} ${hit.record.summary}`),
        ...(candidateSearch?.matches ?? []).map((match) => `${match.path}:${match.line} ${match.preview}`),
        compactSearch.recommendedRecipe?.description ?? "",
      ].join("\n").length / 4);
      // Create a source workspace only after read-only discovery/planning succeeds.
      // A failed catalog/memory lookup must never leave an orphan linked worktree.
      const isolatedWorkspace = project && repository?.git.available && classification.isolation === "isolated-worktree"
        ? await prepareProjectWorktree(project.path)
        : undefined;
      const workspacePath = isolatedWorkspace?.workspacePath ?? project?.path;
      const orchestration: WorkflowOrchestrationSnapshot = {
        ...classification,
        ...(isolatedWorkspace?.baseCommit || repository?.git.head?.sha ? { baseCommit: isolatedWorkspace?.baseCommit ?? repository?.git.head?.sha } : {}),
        ...(repository?.git.branch ? { baseBranch: repository.git.branch } : {}),
        ...(workspacePath ? { workspacePath } : {}),
        changedPaths, affectedPaths, reservedResources: [...new Set([
          ...reservedResources,
          ...(isolatedWorkspace?.created ? [isolatedWorkspace.workspacePath] : []),
        ])].slice(0, 40),
        overlappingPaths: contention.overlappingPaths, overlappingResources: contention.overlappingResources,
        activeProjectWorkflows, conflictingWorkflowCount: contention.conflictingWorkflowCount,
        memoryHits: agentMemory.length + repoMemory.length + (search.recommendedRecipe ? 1 : 0),
        contextEstimateTokens,
        cleanupState: classification.isolation === "direct" ? "not-required" : "pending",
        ...(search.recommendedRecipe ? { recipeUsed: search.recommendedRecipe.id } : {}),
        createdAt: new Date().toISOString(),
      };
      const toolset = {
        ...toolsetInfo(tools, context.scope, context.toolProfile),
        activePack: { source: intentRoute.catalogMatched ? "catalog" : "semantic-fallback",
          count: routedTools.length, names: routedTools.map((tool) => tool.name).slice(0, 20) },
      };
      const discovery = {
        catalog: search.catalog,
        complete: !search.catalog.truncated && !(candidateSearch?.truncated ?? false),
        candidatePool: candidateSearch || candidatePool ? {
          source: reusablePool ? "recipe-reuse" : "host-index",
          reused: candidateSearch?.reusedSeed ?? Boolean(reusablePool),
          revision: candidateSearch?.revision ?? candidatePool?.revision,
          candidates: candidateSearch?.candidates.slice(0, 12) ?? [],
          matches: candidateSearch?.matches.slice(0, 12) ?? [],
          truncated: candidateSearch?.truncated ?? candidatePool?.truncated ?? false,
          truncationReasons: candidateSearch?.truncationReasons ?? [],
          hints: candidatePool ? { paths: candidatePool.paths.slice(0, 12), skillIds: candidatePool.skillIds.slice(0, 12),
            connectionIds: candidatePool.connectionIds.slice(0, 12), mcpAliases: candidatePool.mcpAliases.slice(0, 12) } : undefined,
          ...(candidateSearch?.cursor ? { cursor: candidateSearch.cursor } : candidatePool?.cursor ? { cursor: candidatePool.cursor } : {}),
        } : undefined,
      };
      let started;
      try {
        started = await startWorkflow({
          actor,
          scope: context.scope,
          intent,
          project: project?.path ?? projectHint,
          constraints: opt(a, "constraints"),
          orchestration,
          candidatePool,
        });
      } catch (error) {
        if (isolatedWorkspace?.created) await discardPreparedProjectWorktree(isolatedWorkspace).catch(() => false);
        throw error;
      }
      if (search.recommendedRecipe) {
        await markRecipeRecommended(search.recommendedRecipe.id, { actor: recipeOwner, scope: context.scope }).catch(() => undefined);
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
            agentMemory: agentMemory.map((hit) => ({
              ref: hit.ref, document: hit.document, kind: hit.document === "USER.md" ? "semantic" : "procedural",
              key: hit.key, value: hit.value, score: hit.score,
            })),
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
            `[Memory] ${agentMemory.length} agent + ${repoMemory.length} repo-local hit(s) · ${search.recommendedRecipe ? `${search.recommendedRecipe.maturity ?? "candidate"} recipe available` : "no reusable recipe selected"} · ~${contextEstimateTokens} context tokens`,
            ...(recipePlan ? [`[Recipe] ${recipePlan.maturity} · ${recipePlan.attempts} attempts · ${recipePlan.successRate}% success · ${recipePlan.steps.length} reusable step(s)`] : []),
            ...(graphAutomation ? [`[Workflow graph] ${graphAutomation.status} · ${graphAutomation.name} · ${graphAutomation.metadata.provenance ?? "private"}`] : [`[Workflow graph] no matching private graph; successful completion will seed a learned draft`]),
            ...(reusableScript ? [`[Automation] ${reusableScript.status} script ${reusableScript.id} available`] : []),
            ...(isolatedWorkspace ? [`[Workspace] ${isolatedWorkspace.created ? "task-owned worktree" : "existing linked worktree"} · ${isolatedWorkspace.workspacePath} · ${isolatedWorkspace.branch || "detached"}`] : []),
            ...(contention.conflictingWorkflowCount ? [`[Collision] ${contention.conflictingWorkflowCount} workflow(s) overlap declared paths/resources`] : []),
            ...(candidateSearch ? [`[Candidates] ${candidateSearch.reusedSeed ? "reused recipe pool" : "host index"} · ${candidateSearch.candidates.length} path candidate(s) · ${candidateSearch.matches.length} bounded content hit(s)`] : []),
            ...(discovery.complete ? [] : [`[Discovery] partial scan — ${[...search.catalog.truncationReasons, ...(candidateSearch?.truncationReasons ?? [])].join(", ")}; do not conclude something is absent`]),
            `[Orient] follow ${AGENT_BOOTSTRAP_SKILL} then the discover→act loop`,
            "[Plan] classify → retrieve minimal memory → isolate if required → execute → progressive verify → learn → workflow_finish",
          ],
          orientation: workflowOrientation(context.scope),
          policy: {
            ...workflowStartPolicy(classification),
            ...(isolatedWorkspace ? { workspace: `Use this exact task workspace for source writes and shell cwd: ${isolatedWorkspace.workspacePath}` } : {}),
          },
        },
        search: compactSearch,
        instruction: "Use the smallest useful returned memory context and any safe recipe. Follow the risk/isolation policy, verify progressively, then call workflow_finish with evidence.",
      };
    },
  };
