import type { Scope } from "@/lib/capabilities/scope";
import { hybridSemanticScore, normalizeSemanticText } from "@/lib/skills/semantic";
import type { LearnedRecipe, WorkflowStoreState } from "./types";

export function recipeText(intent: string, project?: string, summary?: string): string {
  return [intent, project, summary].filter(Boolean).join("\n");
}

export function closestRecipe(
  store: WorkflowStoreState,
  actor: string,
  scope: Scope,
  intent: string,
  project?: string,
): LearnedRecipe | undefined {
  let best: { recipe: LearnedRecipe; score: number } | undefined;
  for (const recipe of Object.values(store.recipes)) {
    if (recipe.actor !== actor || recipe.scope !== scope) continue;
    const semantic = hybridSemanticScore(recipeText(intent, project), recipeText(recipe.intent, recipe.project));
    const exact = recipe.normalizedIntent === normalizeSemanticText(intent) ? 0.2 : 0;
    const projectBonus = project && recipe.project && normalizeSemanticText(project) === normalizeSemanticText(recipe.project) ? 0.08 : 0;
    const score = semantic + exact + projectBonus;
    if (!best || score > best.score) best = { recipe, score };
  }
  return best && best.score >= 0.48 ? best.recipe : undefined;
}
