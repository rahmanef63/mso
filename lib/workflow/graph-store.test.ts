import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LearnedRecipe } from "./types";

const dir = await mkdtemp(path.join(os.tmpdir(), "mso-graph-store-"));
process.env.OS_AGENT_SESSIONS_DIR = dir;
const store = await import("./graph-store");

const graph = { name: "Generic build", description: "test", status: "draft" as const, inputs: {}, metadata: { intent: "build project", normalizedIntent: "build project" }, nodes: [
  { id: "start", name: "Start", type: "manual" as const, position: { x: 0, y: 0 }, config: {} },
  { id: "out", name: "Output", type: "output" as const, position: { x: 200, y: 0 }, config: {} },
], edges: [{ id: "e", source: "start", target: "out" }] };

beforeAll(() => { process.env.OS_WORKFLOW_GRAPH_LEARNING_TEST = "1"; });
afterAll(async () => { delete process.env.OS_WORKFLOW_GRAPH_LEARNING_TEST; await rm(dir, { recursive: true, force: true }); });

describe("private workflow graph store", () => {
  it("isolates principals and enforces revisions", async () => {
    const created = await store.createWorkflowGraph("principal-a", graph);
    expect((await store.listWorkflowGraphs("principal-a"))).toHaveLength(1);
    expect((await store.listWorkflowGraphs("principal-b"))).toHaveLength(0);
    await expect(store.updateWorkflowGraph("principal-a", created.id, "wrong", { ...graph, id: created.id })).rejects.toThrow("revision changed");
    const updated = await store.updateWorkflowGraph("principal-a", created.id, created.revision, { ...graph, id: created.id, name: "Updated" });
    expect(updated.name).toBe("Updated");
  });
  it("deduplicates learned private drafts by fingerprint", async () => {
    const recipe: LearnedRecipe = { id: "recipe-private", actor: "principal-learn", scope: "write", intent: "repeat safe route", normalizedIntent: "repeat safe route", project: "project-x", summary: "ok", embeddingVersion: "fixture", embedding: [], bestSteps: [{ id: "s", tool: "sys_stats", state: "completed", ts: new Date().toISOString() }], lastSteps: [], attempts: 1, successes: 1, failures: 0, averageDurationMs: 1, lastDurationMs: 1, averageWallDurationMs: 1, lastWallDurationMs: 1, quality: { stepAttempts: 1, completedSteps: 1, failedSteps: 0, deniedSteps: 0, rateLimitedSteps: 0, invalidArgSteps: 0, retries: 0, rollbackSignals: 0, timedSteps: 0, totalStepDurationMs: 0, averageStepDurationMs: 0 }, lastQuality: { stepAttempts: 1, completedSteps: 1, failedSteps: 0, deniedSteps: 0, rateLimitedSteps: 0, invalidArgSteps: 0, retries: 0, rollbackSignals: 0, timedSteps: 0, totalStepDurationMs: 0, averageStepDurationMs: 0 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const first = await store.ensureLearnedWorkflowGraph(recipe), second = await store.ensureLearnedWorkflowGraph(recipe);
    expect(first?.id).toBe(second?.id); expect((await store.listWorkflowGraphs(recipe.actor))).toHaveLength(1);
  });
});
