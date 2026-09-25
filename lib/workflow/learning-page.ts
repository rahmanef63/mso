import { listLearnedRecipes, listArchivedRecipes } from "./learning";
import { recipeMaturity } from "./maturity";
import { resolveProjectHint } from "@/lib/host/projects-api";
import { readAutomationScript } from "@/lib/orchestration/repo-memory-artifacts";
import type { LearnedRecipe } from "./types";
import { readLearningGraphReceipt } from "./learning-graph-receipt";

function sources(recipe: LearnedRecipe) {
  return [...new Map([...recipe.bestSteps, ...recipe.lastSteps].map(step => step.provenance).filter(Boolean)
    .map(source => [`${source!.sessionLabel}:${source!.actionRef}`, source!])).values()];
}
export async function learningPage(input: { offset?: number; limit?: number; includeArchived?: boolean; sessionLabel?: string }) {
  const active = await listLearnedRecipes({ ownerView: true });
  const archived = input.includeArchived ? await listArchivedRecipes({ ownerView: true }) : [];
  const byId = new Map(archived.map(recipe => [recipe.id, recipe]));
  active.forEach(recipe => byId.set(recipe.id, recipe));
  const recipes = [...byId.values()].filter(recipe => !input.sessionLabel || sources(recipe).some(source => source.sessionLabel === input.sessionLabel))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const offset = Number.isFinite(input.offset) ? Math.max(0, Math.trunc(input.offset!)) : 0;
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(100, Math.trunc(input.limit!))) : 40;
  const warnings: string[] = [];
  const rows = await Promise.all(recipes.slice(offset, offset + limit).map(async recipe => {
    const maturity = recipeMaturity(recipe);
    let scriptStatus: "candidate" | "tested" | undefined;
    if (recipe.project) {
      try {
        const project = await resolveProjectHint(recipe.project);
        if (project && project.matchedBy !== "fuzzy") scriptStatus = (await readAutomationScript(project.path, `script_${recipe.id}`))?.status;
      } catch { warnings.push(`Script status unavailable for recipe ${recipe.id}`); }
    }
    const graphReceipt = await readLearningGraphReceipt(recipe).catch(() => ({ state: "warning" as const, warning: "Graph receipt unavailable" }));
    return { id: recipe.id, intent: recipe.intent, project: recipe.project, maturity: maturity.maturity,
      stage: scriptStatus === "tested" ? "tested" : maturity.maturity, scriptStatus,
      attempts: recipe.attempts, successes: recipe.successes, failures: recipe.failures,
      successRate: Math.round(maturity.successRate * 1000) / 10, fastestDurationMs: recipe.fastestDurationMs,
      updatedAt: recipe.updatedAt, archived: !active.some(row => row.id === recipe.id), graphReceipt,
      sourceSessions: sources(recipe).map(source => ({ label: source.sessionLabel, actionRef: source.actionRef, eventRef: source.eventRef, artifactRefs: source.artifactRefs ?? [] })),
      forge: { eligible: recipe.qualityVersion === 1 && recipe.successes >= 2 && recipe.attempts > 0 && recipe.successes / recipe.attempts >= 0.9 && recipe.bestSteps.length > 0 && recipe.bestSteps.every(step => step.state === "completed"), promotion: "explicit" as const },
    };
  }));
  return { recipes: rows, total: recipes.length, offset, limit,
    ...(offset + rows.length < recipes.length ? { nextOffset: offset + rows.length } : {}),
    includeArchived: Boolean(input.includeArchived), warnings,
    scope: "Recorded best and latest run provenance; absence is not proof that a session was never learned." };
}
