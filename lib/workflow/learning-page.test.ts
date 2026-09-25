import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ active: vi.fn(), archived: vi.fn() }));
vi.mock("./learning", () => ({ listLearnedRecipes: mocks.active, listArchivedRecipes: mocks.archived }));
vi.mock("./learning-graph-receipt", () => ({ readLearningGraphReceipt: async () => null }));
vi.mock("./maturity", () => ({ recipeMaturity: () => ({ maturity: "observed", successRate: 1 }) }));
import { learningPage } from "./learning-page";
const recipe = (id: string, label: string) => ({ id, actor: "mcp-client:test", intent: id, updatedAt: `2026-09-25T00:00:00Z`, bestSteps: [], lastSteps: [{ state: "completed", provenance: { sessionLabel: label, actionRef: "S1.A1", eventRef: "E1" } }], attempts: 1, successes: 1, failures: 0 });
describe("learning pagination and provenance", () => {
  it("finds archived and latest-run links before paginating", async () => {
    mocks.active.mockResolvedValue(Array.from({ length: 120 }, (_, i) => recipe(`active-${i}`, "unrelated")));
    mocks.archived.mockResolvedValue([recipe("old-linked", "target")]);
    const page = await learningPage({ includeArchived: true, sessionLabel: "target" });
    expect(page.total).toBe(1); expect(page.recipes[0]).toMatchObject({ id: "old-linked", archived: true });
  });
  it("exposes nextOffset and never converts a read failure into empty data", async () => {
    mocks.active.mockResolvedValue(Array.from({ length: 45 }, (_, i) => recipe(`active-${i}`, "target")));
    mocks.archived.mockResolvedValue([]);
    const page = await learningPage({ limit: 20 }); expect(page.recipes).toHaveLength(20); expect(page.nextOffset).toBe(20);
    mocks.active.mockRejectedValue(new Error("store unavailable")); await expect(learningPage({})).rejects.toThrow("store unavailable");
  });
});
