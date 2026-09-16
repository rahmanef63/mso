import { describe, expect, it } from "vitest";
import type { LearnedRecipe, WorkflowStep } from "./types";
import { recipeMaturity } from "./maturity";

const step = (tool: string): WorkflowStep => ({ id: tool, tool, state: "completed", ts: new Date().toISOString() });
function recipe(overrides: Partial<LearnedRecipe> = {}): LearnedRecipe {
  return {
    id: "r", actor: "a", scope: "read", intent: "health", normalizedIntent: "health", summary: "ok", embeddingVersion: "x", embedding: [],
    bestSteps: [step("sys_stats")], lastSteps: [step("sys_stats")], attempts: 1, successes: 1, failures: 0,
    averageDurationMs: 1, fastestDurationMs: 1, lastDurationMs: 1, averageWallDurationMs: 1, lastWallDurationMs: 1,
    quality: { stepAttempts: 1, completedSteps: 1, failedSteps: 0, deniedSteps: 0, rateLimitedSteps: 0, invalidArgSteps: 0, retries: 0, rollbackSignals: 0, timedSteps: 0, totalStepDurationMs: 0, averageStepDurationMs: 0 },
    lastQuality: { stepAttempts: 1, completedSteps: 1, failedSteps: 0, deniedSteps: 0, rateLimitedSteps: 0, invalidArgSteps: 0, retries: 0, rollbackSignals: 0, timedSteps: 0, totalStepDurationMs: 0, averageStepDurationMs: 0 },
    qualityVersion: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...overrides,
  };
}

describe("recipe maturity", () => {
  it("keeps one-off and 50% routes observed", () => {
    expect(recipeMaturity(recipe()).maturity).toBe("observed");
    expect(recipeMaturity(recipe({ attempts: 2, successes: 1, failures: 1 })).maturity).toBe("observed");
  });
  it("promotes repeated successes to candidate before verification", () => {
    expect(recipeMaturity(recipe({ attempts: 2, successes: 2 })).maturity).toBe("candidate");
  });
  it("requires stable route, >=3 successes and >=80% success for verified", () => {
    expect(recipeMaturity(recipe({ attempts: 3, successes: 3 })).maturity).toBe("verified");
    expect(recipeMaturity(recipe({ attempts: 4, successes: 3, failures: 1, lastSteps: [step("apps_list")] })).maturity).toBe("candidate");
  });
});
