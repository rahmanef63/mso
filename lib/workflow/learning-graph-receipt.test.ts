import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
const mocks = vi.hoisted(() => ({ ensure: vi.fn() }));
vi.mock("./graph-store", () => ({ ensureLearnedWorkflowGraph: mocks.ensure, workflowGraphOwner: () => "a".repeat(64) }));
import { learnedGraphReceipt, readLearningGraphReceipt } from "./learning-graph-receipt";
import type { LearnedRecipe } from "./types";
const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
describe("observable learning persistence", () => {
  it("persists graph capacity failures as warnings without discarding recipes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-learning-receipt-")); roots.push(root); vi.stubEnv("OS_AGENT_SESSIONS_DIR", root);
    mocks.ensure.mockRejectedValue(new Error("workflow_graph_capacity_reached: 200 graphs; recipe retained, no graphs deleted"));
    const recipe = { id: "test-recipe", actor: "mcp-client:test" } as LearnedRecipe;
    const receipt = await learnedGraphReceipt(recipe); expect(receipt.state).toBe("warning");
    expect((await readLearningGraphReceipt(recipe))?.warning).toContain("recipe retained");
  });
});
