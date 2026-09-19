import { normalizeSemanticText } from "@/lib/skills/semantic";
import { safeMemoryText } from "./sanitize";
import type { LearnedRecipe } from "./types";

export function mergeIntentAliases(existing: LearnedRecipe | undefined, nextIntent: string): string[] {
  if (!existing) return [];
  const normalizedNext = normalizeSemanticText(nextIntent);
  const candidates = [...(existing.intentAliases ?? []), existing.intent]
    .map((value) => safeMemoryText(value, 1000))
    .filter((value): value is string => Boolean(value))
    .filter((value) => normalizeSemanticText(value) !== normalizedNext);
  return [...new Set(candidates)].slice(-12);
}

function successfulToolRoute(steps: LearnedRecipe["bestSteps"]): string[] {
  const out: string[] = [];
  for (const step of steps) {
    if (step.state !== "completed") continue;
    if (out.at(-1) !== step.tool) out.push(step.tool);
  }
  return out;
}

export function recipeReuseScore(recipe: LearnedRecipe, steps: LearnedRecipe["lastSteps"]): number {
  const expected = successfulToolRoute(recipe.bestSteps);
  const actual = successfulToolRoute(steps);
  if (!expected.length || !actual.length) return 0;
  let matched = 0, cursor = 0;
  for (const tool of expected) {
    const index = actual.indexOf(tool, cursor);
    if (index < 0) continue;
    matched += 1;
    cursor = index + 1;
  }
  return Math.round((matched / expected.length) * 1000) / 1000;
}
