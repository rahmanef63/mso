import type { LearnedRecipe, RecipeMaturity, WorkflowStep } from "./types";

function successfulTools(steps: WorkflowStep[]): string[] {
  return steps.filter((step) => step.state === "completed").map((step) => step.tool);
}
export function recipeRouteStable(recipe: LearnedRecipe): boolean {
  const best = successfulTools(recipe.bestSteps), last = successfulTools(recipe.lastSteps);
  if (!best.length || !last.length) return false;
  const compact = (rows: string[]) => rows.filter((tool, index) => index === 0 || tool !== rows[index - 1]);
  const a = compact(best), b = compact(last);
  return a.length === b.length && a.every((tool, index) => tool === b[index]);
}
export function recipeMaturity(recipe: LearnedRecipe): { maturity: RecipeMaturity; successRate: number; stableSteps: boolean } {
  const attempts = Math.max(0, recipe.attempts || 0), successes = Math.max(0, recipe.successes || 0);
  const successRate = attempts ? successes / attempts : 0, stableSteps = attempts >= 2 && recipeRouteStable(recipe);
  let maturity: RecipeMaturity = "observed";
  if (successes >= 2 && attempts >= 2) maturity = "candidate";
  if (successes >= 3 && successRate >= 0.8 && stableSteps) maturity = "verified";
  return { maturity, successRate: Math.round(successRate * 1000) / 1000, stableSteps };
}
