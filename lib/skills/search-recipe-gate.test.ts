import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-recipe-gate-"));
process.env.OS_SKILL_MEMORY_STORE = path.join(dir, "memory.json");
const memory = await import("./memory");
const { searchSkillMemory } = await import("./search");

const actor = "mcp:recipe-gate";
const intent = "verify bounded server health";

async function successfulRun() {
  const started = await memory.startWorkflow({ actor, scope: "read", intent });
  await memory.recordWorkflowStep(actor, started.workflow.id, {
    id: `step-${Date.now()}-${Math.random()}`,
    tool: "sys_stats",
    state: "completed",
    durationMs: 4,
    ts: new Date().toISOString(),
  });
  await memory.finishWorkflow({ actor, recipeActor: actor, workflowId: started.workflow.id, summary: "healthy", success: true });
}

async function search() {
  return searchSkillMemory(intent, {
    recipeAccess: { actor, scope: "read" },
    projects: [],
    topK: 20,
    toolDocs: [{ name: "sys_stats", description: "Live server health", scope: "read", inputSchema: { properties: {} } }],
  });
}

describe("reusable recipe recommendation gate", () => {
  beforeEach(async () => {
    await fs.rm(process.env.OS_SKILL_MEMORY_STORE!, { force: true });
    memory.resetSkillMemoryCache();
  });
  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("keeps a one-off successful trace as observed memory instead of recommending it as a reusable recipe", async () => {
    await successfulRun();
    const result = await search();
    expect(result.hits.some((hit) => hit.kind === "recipe")).toBe(true);
    expect(result.recommendedRecipe).toBeUndefined();
  });

  it("allows recommendation after the same route succeeds repeatedly", async () => {
    await successfulRun();
    await successfulRun();
    const result = await search();
    expect(result.recommendedRecipe).toMatchObject({ kind: "recipe", attempts: 2, successRate: 100 });
  });
});
