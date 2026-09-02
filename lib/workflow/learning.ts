import { randomUUID } from "node:crypto";
import { allows } from "@/lib/capabilities/scope";
import { embedSkillText, normalizeSemanticText, SKILL_EMBEDDING_VERSION } from "@/lib/skills/semantic";
import { compactRecipeSteps, elapsedMs, enrichBestSteps, mergeQuality, summarizeWorkflowQuality } from "./quality";
import { closestRecipe, recipeText } from "./recipes";
import { safeMemoryText } from "./sanitize";
import { actorKey, removeActiveWorkflow, workflowFor } from "./state";
import { loadWorkflowStore, persistWorkflowStore } from "./storage";
import type { FinishWorkflowResult, LearnedRecipe, RecipeAccess } from "./types";

export async function finishWorkflow(input: {
  actor?: string;
  recipeActor?: string;
  workflowId: string;
  summary: string;
  success: boolean;
}): Promise<FinishWorkflowResult> {
  const actor = actorKey(input.actor);
  const recipeOwner = actorKey(input.recipeActor ?? input.actor);
  const store = await loadWorkflowStore();
  const workflow = workflowFor(store, actor, input.workflowId);
  if (!workflow) throw new Error("workflow_id was not found for this MSO session");

  const now = new Date();
  const wallMs = Math.max(0, now.getTime() - new Date(workflow.startedAt).getTime());
  const durationMs = elapsedMs(workflow.steps, wallMs);
  const existing = closestRecipe(store, recipeOwner, workflow.scope, workflow.intent, workflow.project);
  const previousFastestMs = existing?.fastestDurationMs;
  const summary = safeMemoryText(input.summary, 1200) || (input.success ? "completed" : "failed");
  const vector = embedSkillText(recipeText(workflow.intent, workflow.project, summary));
  const timestamp = now.toISOString();
  const compactSteps = compactRecipeSteps(workflow.steps);
  const currentQuality = summarizeWorkflowQuality(workflow.steps);

  let recipe: LearnedRecipe;
  if (existing) {
    const attempts = existing.attempts + 1;
    const successes = existing.successes + (input.success ? 1 : 0);
    const failures = existing.failures + (input.success ? 0 : 1);
    const faster = input.success && (existing.fastestDurationMs == null || durationMs < existing.fastestDurationMs);
    recipe = {
      ...existing,
      actor: recipeOwner,
      scope: workflow.scope,
      intent: workflow.intent,
      normalizedIntent: normalizeSemanticText(workflow.intent),
      project: workflow.project,
      summary,
      embeddingVersion: SKILL_EMBEDDING_VERSION,
      embedding: vector,
      lastSteps: workflow.steps,
      bestSteps: faster ? compactSteps : (input.success ? enrichBestSteps(existing.bestSteps, compactSteps) : existing.bestSteps),
      attempts,
      successes,
      failures,
      averageDurationMs: Math.round((existing.averageDurationMs * existing.attempts + durationMs) / attempts),
      fastestDurationMs: input.success ? Math.min(existing.fastestDurationMs ?? durationMs, durationMs) : existing.fastestDurationMs,
      lastDurationMs: durationMs,
      averageWallDurationMs: Math.round((existing.averageWallDurationMs * existing.attempts + wallMs) / attempts),
      lastWallDurationMs: wallMs,
      quality: mergeQuality(existing.quality, currentQuality),
      lastQuality: currentQuality,
      qualityVersion: 1,
      updatedAt: timestamp,
    };
  } else {
    recipe = {
      id: randomUUID(), actor: recipeOwner, scope: workflow.scope, intent: workflow.intent,
      normalizedIntent: normalizeSemanticText(workflow.intent), project: workflow.project, summary,
      embeddingVersion: SKILL_EMBEDDING_VERSION, embedding: vector,
      bestSteps: input.success ? compactSteps : [], lastSteps: workflow.steps,
      attempts: 1, successes: input.success ? 1 : 0, failures: input.success ? 0 : 1,
      averageDurationMs: durationMs, fastestDurationMs: input.success ? durationMs : undefined, lastDurationMs: durationMs,
      averageWallDurationMs: wallMs, lastWallDurationMs: wallMs,
      quality: currentQuality, lastQuality: currentQuality, qualityVersion: 1,
      createdAt: timestamp, updatedAt: timestamp,
    };
  }

  store.recipes[recipe.id] = recipe;
  removeActiveWorkflow(store, actor, input.workflowId);
  const recipes = Object.values(store.recipes);
  if (recipes.length > 200) {
    recipes
      .sort((a, b) => {
        const qa = a.successes * 10 - a.failures + new Date(a.lastUsedAt ?? a.updatedAt).getTime() / 1e13;
        const qb = b.successes * 10 - b.failures + new Date(b.lastUsedAt ?? b.updatedAt).getTime() / 1e13;
        return qa - qb;
      })
      .slice(0, recipes.length - 200)
      .forEach((row) => delete store.recipes[row.id]);
  }
  await persistWorkflowStore(store);

  const improvedByMs = input.success && previousFastestMs != null && durationMs < previousFastestMs
    ? previousFastestMs - durationMs : undefined;
  return {
    workflow, recipe, currentDurationMs: durationMs,
    ...(previousFastestMs != null ? { previousFastestMs } : {}),
    ...(improvedByMs != null ? { improvedByMs, improvedPct: Math.round((improvedByMs / previousFastestMs!) * 1000) / 10 } : {}),
  };
}

export async function listLearnedRecipes(access: RecipeAccess): Promise<LearnedRecipe[]> {
  const store = await loadWorkflowStore();
  const recipes = Object.values(store.recipes);
  const visible = access.ownerView ? recipes : recipes.filter((recipe) => recipe.actor === access.actor && allows(access.scope, recipe.scope));
  return visible.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function markRecipeUsed(id: string, access: RecipeAccess): Promise<void> {
  const store = await loadWorkflowStore();
  const recipe = store.recipes[id];
  if (!recipe) return;
  if (!access.ownerView && (recipe.actor !== access.actor || !allows(access.scope, recipe.scope))) return;
  recipe.lastUsedAt = new Date().toISOString();
  await persistWorkflowStore(store);
}
