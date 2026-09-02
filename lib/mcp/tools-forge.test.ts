import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveProjectHint: vi.fn(async () => ({ path: "/tmp/project", id: "root/project", hint: "project", matchedBy: "name" })),
  listLearnedRecipes: vi.fn(async () => [{ id: "recipe-1", scope: "read", intent: "x", summary: "x", attempts: 2, successes: 2, failures: 0, qualityVersion: 1, quality: {}, bestSteps: [], updatedAt: "2026-09-02T00:00:00Z" }]),
  proposeForgeCandidate: vi.fn(async (input) => ({ version: 1, id: "forge_20260902_000000_aaaaaaaaaaaa", ownerHash: "h", kind: input.kind, state: "draft", projectPath: input.projectPath, recipe: { id: input.recipe.id }, requiredScope: "read", createdAt: "x", updatedAt: "x", skill: { name: "x", content: "x" } })),
  getForgeCandidate: vi.fn(async () => ({ version: 1, id: "forge_20260902_000000_aaaaaaaaaaaa", ownerHash: "h", kind: "skill", state: "draft", projectPath: "/tmp/project", recipe: { id: "recipe-1", bestSteps: [], quality: {}, attempts: 2, successes: 2, failures: 0, scope: "read", intent: "x", summary: "x", updatedAt: "x" }, requiredScope: "read", createdAt: "x", updatedAt: "x", skill: { name: "x", content: "x" } })),
  listForgeCandidates: vi.fn(async () => []),
  publicForgeCandidate: vi.fn((candidate) => ({ id: candidate.id, state: candidate.state, kind: candidate.kind })),
  updateForgeCandidate: vi.fn(async (_id, _owner, mutate) => mutate(await mocks.getForgeCandidate())),
  evaluateForgeCandidate: vi.fn(async () => ({ version: 1, candidateHash: "hash", passed: true, evaluatedAt: "x", checks: [], targetHash: "absent", fixtureCount: 0 })),
  promoteForgeCandidate: vi.fn(async () => ({ at: "x", path: "/tmp/project/.mso/skills/x/SKILL.md", verification: "local" })),
}));

vi.mock("@/lib/host", () => ({ resolveProjectHint: mocks.resolveProjectHint }));
vi.mock("@/lib/workflow", () => ({ listLearnedRecipes: mocks.listLearnedRecipes }));
vi.mock("@/lib/forge/proposal", () => ({ proposeForgeCandidate: mocks.proposeForgeCandidate }));
vi.mock("@/lib/forge/evaluate", () => ({ evaluateForgeCandidate: mocks.evaluateForgeCandidate }));
vi.mock("@/lib/forge/promote", () => ({ promoteForgeCandidate: mocks.promoteForgeCandidate }));
vi.mock("@/lib/forge/store", () => ({
  getForgeCandidate: mocks.getForgeCandidate, listForgeCandidates: mocks.listForgeCandidates,
  publicForgeCandidate: mocks.publicForgeCandidate, updateForgeCandidate: mocks.updateForgeCandidate,
}));

const { FORGE_TOOLS } = await import("./tools-forge");
const tool = (name: string) => {
  const found = FORGE_TOOLS.find((row) => row.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
};
const context = { actor: "mcp:token", recipeActor: "mcp-client:stable", scope: "exec" as const };

describe("MCP Tool Forge wrappers", () => {
  it("proposes only from the stable recipe owner and resolved project", async () => {
    const result = await tool("tool_forge_propose").run({ recipe_id: "recipe-1", kind: "skill", project: "project", name: "health" }, context) as { id: string };
    expect(result.id).toMatch(/^forge_/);
    expect(mocks.listLearnedRecipes).toHaveBeenCalledWith({ actor: "mcp-client:stable", scope: "exec" });
    expect(mocks.proposeForgeCandidate).toHaveBeenCalledWith(expect.objectContaining({ owner: "mcp-client:stable", projectPath: "/tmp/project", kind: "skill" }));
  });

  it("requires the exact explicit promotion phrase before any evaluation/promotion", async () => {
    await expect(tool("tool_forge_promote").run({ candidate_id: "forge_20260902_000000_aaaaaaaaaaaa", confirmation: "yes" }, context))
      .rejects.toThrow(/PROMOTE forge_20260902_000000_aaaaaaaaaaaa/);
    expect(mocks.evaluateForgeCandidate).not.toHaveBeenCalled();
    expect(mocks.promoteForgeCandidate).not.toHaveBeenCalled();
  });
});
