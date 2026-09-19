import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { WorkflowOrchestrationSnapshot } from "@/lib/contracts/orchestration";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-recipe-reuse-"));
process.env.OS_SKILL_MEMORY_STORE = path.join(dir, "memory.json");
const memory = await import("./index");

const orchestration = (recipeUsed: string): WorkflowOrchestrationSnapshot => ({
  risk: "low", complexity: "light", contention: "none", memoryRelevance: "medium",
  isolation: "direct", verification: "targeted", reasons: [], sharedResourceWarnings: [],
  changedPaths: [], affectedPaths: [], reservedResources: [], overlappingPaths: [], overlappingResources: [],
  activeProjectWorkflows: 0, conflictingWorkflowCount: 0, memoryHits: 1, contextEstimateTokens: 100,
  cleanupState: "not-required", recipeUsed, createdAt: new Date().toISOString(),
});

describe("recipe recommendation telemetry", () => {
  beforeEach(async () => {
    await fs.rm(process.env.OS_SKILL_MEMORY_STORE!, { force: true });
    memory.resetWorkflowStoreCache();
  });
  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("separates recommendation from observed route matching", async () => {
    const actor = "mcp:reuse-telemetry";
    const first = await memory.startWorkflow({ actor, intent: "check server health", project: "mso" });
    await memory.recordWorkflowStep(actor, first.workflow.id, {
      id: "stats-1", tool: "sys_stats", state: "completed", durationMs: 10, ts: new Date().toISOString(),
    });
    const seeded = await memory.finishWorkflow({ actor, workflowId: first.workflow.id, summary: "health checked", success: true });
    await memory.markRecipeRecommended(seeded.recipe.id, { actor, scope: "read" });

    const matched = await memory.startWorkflow({ actor, intent: "check server health again", project: "mso", orchestration: orchestration(seeded.recipe.id) });
    await memory.recordWorkflowStep(actor, matched.workflow.id, {
      id: "stats-2", tool: "sys_stats", state: "completed", durationMs: 8, ts: new Date().toISOString(),
    });
    const matchedDone = await memory.finishWorkflow({ actor, workflowId: matched.workflow.id, summary: "same route verified", success: true });
    expect(matchedDone.reuse).toMatchObject({ recommendedRecipeId: seeded.recipe.id, routeMatched: true, score: 1 });

    const diverged = await memory.startWorkflow({ actor, intent: "check server health with another method", project: "mso", orchestration: orchestration(seeded.recipe.id) });
    await memory.recordWorkflowStep(actor, diverged.workflow.id, {
      id: "read", tool: "fs_read", state: "completed", target: "/tmp/health.txt",
      args: { path: "/tmp/health.txt" }, durationMs: 7, ts: new Date().toISOString(),
    });
    const divergedDone = await memory.finishWorkflow({ actor, workflowId: diverged.workflow.id, summary: "alternate route verified", success: true });
    expect(divergedDone.reuse).toMatchObject({ recommendedRecipeId: seeded.recipe.id, routeMatched: false, score: 0 });

    const recipes = await memory.listLearnedRecipes({ actor, scope: "read" });
    const tracked = recipes.find((recipe) => recipe.id === seeded.recipe.id)!;
    expect(tracked).toMatchObject({ recommendationCount: 1, routeMatchCount: 1, routeDivergenceCount: 1 });
    expect(tracked.lastRecommendedAt).toBeTruthy();
    expect(tracked.lastRouteMatchedAt).toBeTruthy();
    expect(tracked.lastRouteDivergedAt).toBeTruthy();
    expect(tracked.lastUsedAt).toBeUndefined();
  });
});
