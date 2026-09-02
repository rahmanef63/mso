import { catalogSkillsDetailed, readSkillFile, type ProjectRef, type SkillInfo, type SkillScanReport } from "./catalog";
import { listLearnedRecipes, type LearnedRecipe, type RecipeAccess } from "./memory";
import { embedSkillText, hybridSemanticScore, prepareSemanticQuery, SKILL_EMBEDDING_VERSION } from "./semantic";

export type SkillSearchToolDoc = {
  name: string;
  description: string;
  scope: string;
  inputSchema?: { properties?: Record<string, unknown> };
};

export type SkillSearchHit = {
  kind: "recipe" | "skill" | "tool";
  id: string;
  name: string;
  /** Set when the hit is a skill that lives inside a project checkout. */
  project?: ProjectRef;
  score: number;
  description: string;
  source?: string;
  trust?: string;
  scope?: string;
  successRate?: number;
  fastestDurationMs?: number;
  attempts?: number;
  steps?: Array<{ tool: string; target?: string; args?: Record<string, string | number | boolean>; durationMs?: number }>;
  missingTools?: string[];
};

export type SkillSearchOptions = {
  topK?: number;
  includeUntrusted?: boolean;
  toolDocs?: SkillSearchToolDoc[];
  appDir?: string;
  homeDir?: string;
  /** Forwarded to catalogSkills; `[]` restricts the search to global roots. */
  projects?: ProjectRef[];
  /** Explicit recipe visibility. Omit to search skills/tools only. */
  recipeAccess?: RecipeAccess;
};

function skillQuality(skill: SkillInfo): number {
  if (skill.trust === "official") return 0.09;
  if (skill.trust === "verified") return 0.07;
  if (skill.trust === "local") return 0.08;
  return -0.12;
}

function recipeQuality(recipe: LearnedRecipe): number {
  const successRate = recipe.attempts ? recipe.successes / recipe.attempts : 0;
  const evidence = Math.min(recipe.attempts, 6) / 6;
  return successRate * 0.13 + evidence * 0.05 + (recipe.successes > 0 ? 0.02 : 0);
}

export async function searchSkillMemory(query: string, options: SkillSearchOptions = {}): Promise<{
  engine: string;
  query: string;
  hits: SkillSearchHit[];
  /** What the underlying catalog build could NOT cover. A search over a truncated
   *  catalog is a search over part of the box, and the caller has to be able to say so. */
  catalog: SkillScanReport;
  recommendedRecipe?: SkillSearchHit;
}> {
  const preparedQuery = prepareSemanticQuery(query);
  const q = preparedQuery.raw;
  const topK = Math.min(Math.max(Math.round(options.topK ?? 8), 1), 20);
  const hits: SkillSearchHit[] = [];
  const availableTools = options.toolDocs?.length ? new Set(options.toolDocs.map((t) => t.name)) : null;

  const recipes = options.recipeAccess ? await listLearnedRecipes(options.recipeAccess) : [];
  for (const recipe of recipes) {
    const text = [
      recipe.intent,
      recipe.project,
      recipe.summary,
      recipe.bestSteps.map((s) => `${s.tool} ${s.target ?? ""}`).join(" "),
    ].filter(Boolean).join("\n");
    const raw = hybridSemanticScore(preparedQuery, text, recipe.embeddingVersion === SKILL_EMBEDDING_VERSION ? recipe.embedding : embedSkillText(text));
    const missingTools = availableTools
      ? [...new Set(recipe.bestSteps.map((s) => s.tool).filter((tool) => !availableTools.has(tool)))]
      : [];
    hits.push({
      kind: "recipe",
      id: recipe.id,
      name: recipe.intent,
      score: Math.max(0, Math.min(1, raw + recipeQuality(recipe) - missingTools.length * 0.15)),
      description: recipe.summary,
      source: "learned",
      trust: "local",
      successRate: recipe.attempts ? Math.round((recipe.successes / recipe.attempts) * 1000) / 10 : 0,
      fastestDurationMs: recipe.fastestDurationMs,
      attempts: recipe.attempts,
      steps: recipe.bestSteps.map((s) => ({ tool: s.tool, target: s.target, args: s.args, durationMs: s.durationMs })),
      ...(missingTools.length ? { missingTools } : {}),
    });
  }

  const { skills, scan } = await catalogSkillsDetailed({ appDir: options.appDir, homeDir: options.homeDir, projects: options.projects });
  for (const skill of skills) {
    if (!options.includeUntrusted && skill.trust === "untrusted") continue;
    const content = skill.trust === "untrusted" ? "" : (await readSkillFile(skill.path))?.slice(0, 18_000) ?? "";
    const text = `${skill.id}\n${skill.name}\n${skill.project?.name ?? ""}\n${skill.description}\n${content}`;
    hits.push({
      kind: "skill",
      id: skill.id,
      name: skill.name,
      ...(skill.project ? { project: skill.project } : {}),
      score: Math.max(0, Math.min(1, hybridSemanticScore(preparedQuery, text) + skillQuality(skill))),
      description: skill.description,
      source: skill.source,
      trust: skill.trust,
    });
  }

  for (const tool of options.toolDocs ?? []) {
    const params = Object.keys(tool.inputSchema?.properties ?? {}).join(" ");
    const text = `${tool.name}\n${tool.description}\n${params}`;
    hits.push({
      kind: "tool",
      id: tool.name,
      name: tool.name,
      score: Math.min(1, hybridSemanticScore(preparedQuery, text) + 0.055),
      description: tool.description,
      source: "mcp",
      trust: "official",
      scope: tool.scope,
    });
  }

  const sorted = hits
    .filter((h) => h.score >= 0.04)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, topK)
    .map((h) => ({ ...h, score: Math.round(h.score * 1000) / 1000 }));
  return {
    engine: SKILL_EMBEDDING_VERSION,
    query: q,
    hits: sorted,
    catalog: scan,
    recommendedRecipe: sorted.find((h) =>
      h.kind === "recipe" && h.score >= 0.22 && (h.attempts ?? 0) >= 2 && (h.successRate ?? 0) >= 50,
    ),
  };
}
