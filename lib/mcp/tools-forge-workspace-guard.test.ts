import { beforeEach, describe, expect, it, vi } from "vitest";

const guard = vi.fn();
const getForgeCandidate = vi.fn();
vi.mock("./workflow-workspace-guard", () => ({ requireWorkflowProjectTarget: guard }));
vi.mock("@/lib/forge/store", () => ({
  getForgeCandidate, listForgeCandidates:vi.fn(), publicForgeCandidate:vi.fn((value)=>value), updateForgeCandidate:vi.fn(),
}));
vi.mock("@/lib/forge/evaluate", () => ({ evaluateForgeCandidate:vi.fn() }));
vi.mock("@/lib/forge/promote", () => ({ promoteForgeCandidate:vi.fn() }));
vi.mock("@/lib/forge/proposal", () => ({ proposeForgeCandidate:vi.fn() }));
vi.mock("@/lib/workflow", () => ({ listLearnedRecipes:vi.fn(async()=>[]) }));

const { FORGE_TOOLS } = await import("./tools-forge");

describe("Tool Forge source workspace guard", () => {
  beforeEach(() => { guard.mockReset(); getForgeCandidate.mockReset(); });
  it("checks the candidate project path before promotion evaluation or write", async () => {
    getForgeCandidate.mockResolvedValue({ id:"cand-1", state:"evaluated", projectPath:"/canonical/project" });
    guard.mockRejectedValue(new Error("source-isolated"));
    const promote = FORGE_TOOLS.find((tool) => tool.name === "tool_forge_promote")!;
    await expect(promote.run({ candidate_id:"cand-1", confirmation:"PROMOTE cand-1" }, { actor:"owner", scope:"exec" })).rejects.toThrow("source-isolated");
    expect(guard).toHaveBeenCalledWith(expect.objectContaining({ actor:"owner" }), "/canonical/project");
  });
});
