import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LearnedRecipe } from "./types";

const dir = await mkdtemp(path.join(os.tmpdir(), "mso-recipe-archive-"));
process.env.OS_SKILL_MEMORY_STORE = path.join(dir, "skill-memory.json");
const archive = await import("./recipe-archive");
const now = new Date().toISOString();
const recipe: LearnedRecipe = {
  id: "archived-recipe", actor: "actor-a", scope: "read", intent: "old route", normalizedIntent: "old route", summary: "ok", embeddingVersion: "x", embedding: [],
  bestSteps: [{ id: "a", tool: "sys_stats", state: "completed", ts: now }], lastSteps: [], attempts: 2, successes: 2, failures: 0,
  averageDurationMs: 1, fastestDurationMs: 1, lastDurationMs: 1, averageWallDurationMs: 1, lastWallDurationMs: 1,
  quality: { stepAttempts: 1, completedSteps: 1, failedSteps: 0, deniedSteps: 0, rateLimitedSteps: 0, invalidArgSteps: 0, retries: 0, rollbackSignals: 0, timedSteps: 0, totalStepDurationMs: 0, averageStepDurationMs: 0 },
  lastQuality: { stepAttempts: 1, completedSteps: 1, failedSteps: 0, deniedSteps: 0, rateLimitedSteps: 0, invalidArgSteps: 0, retries: 0, rollbackSignals: 0, timedSteps: 0, totalStepDurationMs: 0, averageStepDurationMs: 0 },
  qualityVersion: 1, createdAt: now, updatedAt: now,
};
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe("learned recipe archive", () => {
  it("keeps evicted recipes explicitly retrievable with owner/scope filtering", async () => {
    await archive.archiveLearnedRecipes([recipe]);
    expect(await archive.listArchivedLearnedRecipes({ actor: "actor-a", scope: "read" })).toMatchObject([{ id: recipe.id }]);
    expect(await archive.listArchivedLearnedRecipes({ actor: "actor-b", scope: "read" })).toEqual([]);
    expect(await archive.listArchivedLearnedRecipes({ ownerView: true })).toMatchObject([{ id: recipe.id }]);
  });
});
