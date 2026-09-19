import { createHash, randomUUID } from "node:crypto";
import { allows } from "@/lib/capabilities/scope";
import { embedSkillText, hybridSemanticScore, normalizeSemanticText, SKILL_EMBEDDING_VERSION } from "@/lib/skills/semantic";
import { compactRecipeSteps, elapsedMs, enrichBestSteps, mergeQuality, summarizeWorkflowQuality } from "./quality";
import { closestRecipe, recipeText } from "./recipes";
import { safeMemoryText } from "./sanitize";
import { actorKey, removeActiveWorkflow, workflowFor } from "./state";
import { loadWorkflowStore, persistWorkflowStore } from "./storage";
import type { FinishWorkflowResult, LearnedRecipe, RecipeAccess, WorkflowStepProvenance } from "./types";
import { ensureLearnedWorkflowGraph } from "./graph-store";
import { archiveLearnedRecipes, listArchivedLearnedRecipes } from "./recipe-archive";
import { mergeCandidatePools } from "./candidate-pool";
import { rememberAgentMemory } from "@/lib/agent/memory-store";
import { mergeIntentAliases, recipeReuseScore } from "./recipe-reuse";

export async function finishWorkflow(input: {
  actor?: string;
  recipeActor?: string;
  workflowId: string;
  summary: string;
  success: boolean;
  stepProvenance?: Record<string, WorkflowStepProvenance>;
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
  const timestamp = now.toISOString();
  const learnedSteps = workflow.steps.map((step) => input.stepProvenance?.[step.id] ? { ...step, provenance: input.stepProvenance[step.id] } : step);
  const compactSteps = compactRecipeSteps(learnedSteps);
  const currentQuality = summarizeWorkflowQuality(workflow.steps);
  const intentAliases = mergeIntentAliases(existing, workflow.intent);
  const vector = embedSkillText(recipeText([workflow.intent, ...intentAliases].join("\n"), workflow.project, summary));
  const recommendedRecipeId = workflow.orchestration?.recipeUsed;
  const recommendedRecipe = recommendedRecipeId ? store.recipes[recommendedRecipeId] : undefined;
  const reuseScore = recommendedRecipe ? recipeReuseScore(recommendedRecipe, learnedSteps) : 0;
  const routeMatched = Boolean(recommendedRecipe && input.success && reuseScore >= 0.6);

  let recipe: LearnedRecipe;
  if (existing) {
    const attempts = existing.attempts + 1;
    const successes = existing.successes + (input.success ? 1 : 0);
    const failures = existing.failures + (input.success ? 0 : 1);
    const faster = input.success && (existing.fastestDurationMs == null || durationMs < existing.fastestDurationMs);
    const candidatePool = input.success
      ? mergeCandidatePools(existing.candidatePool, workflow.candidatePool)
      : existing.candidatePool;
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
      ...(intentAliases.length ? { intentAliases } : {}),
      lastSteps: learnedSteps,
      bestSteps: faster ? compactSteps : (input.success ? enrichBestSteps(existing.bestSteps, compactSteps) : existing.bestSteps),
      ...(candidatePool ? { candidatePool } : {}),
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
      bestSteps: input.success ? compactSteps : [], lastSteps: learnedSteps,
      ...(input.success && workflow.candidatePool ? { candidatePool: workflow.candidatePool } : {}),
      attempts: 1, successes: input.success ? 1 : 0, failures: input.success ? 0 : 1,
      averageDurationMs: durationMs, fastestDurationMs: input.success ? durationMs : undefined, lastDurationMs: durationMs,
      averageWallDurationMs: wallMs, lastWallDurationMs: wallMs,
      quality: currentQuality, lastQuality: currentQuality, qualityVersion: 1,
      createdAt: timestamp, updatedAt: timestamp,
    };
  }

  store.recipes[recipe.id] = recipe;
  if (recommendedRecipeId) {
    const recommended = store.recipes[recommendedRecipeId];
    if (recommended) {
      recommended.lastReuseScore = reuseScore;
      if (routeMatched) {
        recommended.routeMatchCount = (recommended.routeMatchCount ?? 0) + 1;
        recommended.lastRouteMatchedAt = timestamp;
      } else {
        recommended.routeDivergenceCount = (recommended.routeDivergenceCount ?? 0) + 1;
        recommended.lastRouteDivergedAt = timestamp;
      }
    }
  }
  removeActiveWorkflow(store, actor, input.workflowId);
  const recipes = Object.values(store.recipes);
  if (recipes.length > 200) {
    const evicted = recipes
      .sort((a, b) => {
        const qa = a.successes * 10 - a.failures + new Date(a.lastRouteMatchedAt ?? a.lastRecommendedAt ?? a.lastUsedAt ?? a.updatedAt).getTime() / 1e13;
        const qb = b.successes * 10 - b.failures + new Date(b.lastRouteMatchedAt ?? b.lastRecommendedAt ?? b.lastUsedAt ?? b.updatedAt).getTime() / 1e13;
        return qa - qb;
      })
      .slice(0, recipes.length - 200);
    // Archive before eviction. If archival cannot be proven, keep the recipe active rather than silently losing learned history.
    try { await archiveLearnedRecipes(evicted); evicted.forEach((row) => delete store.recipes[row.id]); } catch { /* retain overflow until a later successful archival pass */ }
  }
  await persistWorkflowStore(store);
  // Successful sanitized session routes automatically become private graph drafts.
  // This is best-effort learning: graph persistence must never turn workflow_finish into a failure.
  if (input.success && process.env.NODE_ENV !== "test") await ensureLearnedWorkflowGraph(recipe).catch(() => undefined);
  if (input.success && process.env.NODE_ENV !== "test") {
    const memoryKey = `workflow:${createHash("sha256").update(`${recipe.normalizedIntent}|${recipe.project ?? ""}`).digest("hex").slice(0, 20)}`;
    const route = recipe.bestSteps.map((step) => step.tool).join(" → ").slice(0, 1200);
    const value = safeMemoryText([`Intent: ${recipe.intent}`, recipe.project ? `Project: ${recipe.project}` : "", `Outcome: ${recipe.summary}`, route ? `Successful route: ${route}` : ""].filter(Boolean).join("\n"), 3000);
    if (value) await rememberAgentMemory(recipeOwner, "MEMORY.md", memoryKey, value, {
      kind: "procedural", sensitivity: "private", confidence: Math.min(1, 0.65 + Math.min(recipe.successes, 7) * 0.05),
      provenance: { authority: "observed", channel: "system" },
    }).catch(() => undefined);
  }

  const improvedByMs = input.success && previousFastestMs != null && durationMs < previousFastestMs
    ? previousFastestMs - durationMs : undefined;
  return {
    workflow, recipe, currentDurationMs: durationMs,
    ...(previousFastestMs != null ? { previousFastestMs } : {}),
    ...(improvedByMs != null ? { improvedByMs, improvedPct: Math.round((improvedByMs / previousFastestMs!) * 1000) / 10 } : {}),
    ...(recommendedRecipeId ? { reuse: { recommendedRecipeId, routeMatched, score: reuseScore } } : {}),
  };
}



export async function findReusableRecipe(input: {
  actor: string;
  scope: import("@/lib/capabilities/scope").Scope;
  intent: string;
  project?: string;
}): Promise<LearnedRecipe | undefined> {
  const store = await loadWorkflowStore();
  const prepared = recipeText(input.intent, input.project);
  let best: { recipe: LearnedRecipe; score: number } | undefined;
  for (const recipe of Object.values(store.recipes)) {
    if (recipe.actor !== input.actor || !allows(input.scope, recipe.scope) || recipe.successes < 1 || !recipe.candidatePool) continue;
    if ((recipe.project ?? "") !== (input.project ?? "")) continue;
    const score = hybridSemanticScore(
      prepared,
      recipeText([recipe.intent, ...(recipe.intentAliases ?? [])].join("\n"), recipe.project, recipe.summary),
      recipe.embeddingVersion === SKILL_EMBEDDING_VERSION ? recipe.embedding : undefined,
    ) + (recipe.normalizedIntent === normalizeSemanticText(input.intent) ? 0.2 : 0);
    if (!best || score > best.score) best = { recipe, score };
  }
  return best && best.score >= 0.48 ? best.recipe : undefined;
}

export async function listLearnedRecipes(access: RecipeAccess): Promise<LearnedRecipe[]> {
  const store = await loadWorkflowStore();
  const recipes = Object.values(store.recipes);
  const visible = access.ownerView ? recipes : recipes.filter((recipe) => recipe.actor === access.actor && allows(access.scope, recipe.scope));
  return visible.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function listArchivedRecipes(access: RecipeAccess): Promise<LearnedRecipe[]> {
  return listArchivedLearnedRecipes(access);
}

export async function markRecipeRecommended(id: string, access: RecipeAccess): Promise<void> {
  const store = await loadWorkflowStore();
  const recipe = store.recipes[id];
  if (!recipe) return;
  if (!access.ownerView && (recipe.actor !== access.actor || !allows(access.scope, recipe.scope))) return;
  const at = new Date().toISOString();
  recipe.recommendationCount = (recipe.recommendationCount ?? 0) + 1;
  recipe.lastRecommendedAt = at;
  await persistWorkflowStore(store);
}

/** @deprecated pre-v3 name; selection is a recommendation, not proof of recipe application. */
export const markRecipeUsed = markRecipeRecommended;
