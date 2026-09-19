import type { Scope } from "@/lib/capabilities/scope";
import { projectCandidateRevision, searchProjectCandidateIndex } from "@/lib/host/project-candidate-index";
import { inspectProject, type ProjectResolution } from "@/lib/host/projects-api";
import { findReusableRecipe, recipeMaturity, type WorkflowCandidatePool } from "@/lib/workflow";
import { searchSkillMemory } from "@/lib/skills/search";
import type { McpTool } from "./tool-kit";
export async function workflowStartCandidateContext(input: {
  intent: string;
  recipeOwner: string;
  scope: Scope;
  project: ProjectResolution | null;
  projectHint?: string;
  repository?: Awaited<ReturnType<typeof inspectProject>>;
  catalogMatched: boolean;
  routedTools: McpTool[];
}) {
  const { intent, recipeOwner, scope, project, projectHint, repository, catalogMatched, routedTools } = input;
  const recipeProject = project?.path ?? projectHint;
  const reusableRecipe = recipeProject
    ? await findReusableRecipe({ actor: recipeOwner, scope: scope, intent, project: recipeProject }).catch(() => undefined)
    : undefined;
  const reusablePool = reusableRecipe?.candidatePool;
  let search: Awaited<ReturnType<typeof searchSkillMemory>>;
  if (reusableRecipe && reusablePool) {
    const availableTools = new Set(routedTools.map((tool) => tool.name));
    const missingTools = [...new Set(reusableRecipe.bestSteps.map((step) => step.tool).filter((tool) => !availableTools.has(tool)))];
    const maturity = recipeMaturity(reusableRecipe).maturity;
    const recipeHit = {
      kind: "recipe" as const,
      id: reusableRecipe.id,
      name: reusableRecipe.intent,
      score: 1,
      description: reusableRecipe.summary,
      source: "learned",
      trust: "local",
      successRate: reusableRecipe.attempts ? Math.round((reusableRecipe.successes / reusableRecipe.attempts) * 1000) / 10 : 0,
      fastestDurationMs: reusableRecipe.fastestDurationMs,
      attempts: reusableRecipe.attempts,
      maturity,
      steps: reusableRecipe.bestSteps.map((step) => ({
        tool: step.tool, target: step.target, args: step.args, durationMs: step.durationMs,
      })),
      ...(missingTools.length ? { missingTools } : {}),
    };
    search = {
      engine: "candidate-pool-reuse-v1",
      query: intent,
      hits: [
        recipeHit,
        ...reusablePool.skillIds.slice(0, 4).map((id) => ({
          kind: "skill" as const,
          id,
          name: id,
          score: 0.5,
          description: "Reused candidate skill id. Read the current trusted skill before using its instructions.",
          source: "recipe-pool",
          trust: "local",
        })),
      ],
      catalog: { truncated: false, truncationReasons: [], scannedRoots: 0, scannedProjects: 0 },
      ...(maturity === "observed" ? {} : { recommendedRecipe: recipeHit }),
    };
  } else {
    search = await searchSkillMemory(intent, {
      topK: catalogMatched ? 5 : 7,
      recipeAccess: { actor: recipeOwner, scope: scope },
      toolDocs: routedTools.map((tool) => ({
        name: tool.name, description: tool.description, scope: tool.scope, inputSchema: tool.inputSchema,
      })),
    });
  }
  const candidateRevision = project ? projectCandidateRevision(repository) : undefined;
  const candidateSearch = project && candidateRevision
    ? await searchProjectCandidateIndex({
      projectPath: project.path,
      query: intent,
      revision: candidateRevision,
      limit: 12,
      ...(reusablePool?.paths.length ? { seedPaths: reusablePool.paths, reuseOnly: true } : {}),
    }).catch(() => undefined)
    : undefined;
  const discoveredPool: WorkflowCandidatePool | undefined = project && candidateRevision ? {
    version: 1,
    revision: candidateRevision,
    paths: candidateSearch?.candidates.map((candidate) => candidate.path).slice(0, 24) ?? [],
    skillIds: search.hits.filter((hit) => hit.kind === "skill").map((hit) => hit.id).slice(0, 16),
    connectionIds: reusablePool?.connectionIds.slice(0, 16) ?? [],
    mcpAliases: reusablePool?.mcpAliases.slice(0, 16) ?? [],
    ...(candidateSearch?.truncated ? { truncated: true } : {}),
    ...(candidateSearch?.cursor ? { cursor: candidateSearch.cursor } : {}),
    ...(reusableRecipe ? { reusedFromRecipe: reusableRecipe.id } : {}),
  } : undefined;
  // A live seed pass validates reused paths. Do not merge stale path strings back in.
  const candidatePool = discoveredPool ?? reusablePool;
  return { search, reusablePool, candidateSearch, candidatePool };
}
