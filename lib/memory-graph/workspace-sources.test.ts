import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ chart: vi.fn(), memory: vi.fn(), discovery: vi.fn(), recipes: vi.fn() }));
vi.mock("@/lib/agent/organization-store", () => ({ getOrganizationChart: mocks.chart }));
vi.mock("@/lib/agent/memory-store", () => ({ queryAgentMemory: mocks.memory }));
vi.mock("@/lib/workflow/owner-discovery", () => ({ requireDiscoveryOwner: (role: string) => { if (role !== "owner") throw new Error("owner_required"); }, discoverOwnerGraphs: mocks.discovery }));
vi.mock("@/lib/workflow/learning", () => ({ listLearnedRecipes: mocks.recipes }));
import { workspaceSources } from "./workspace-sources";
const project = { id: "root/mso", name: "mso", path: "/projects/mso" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.chart.mockResolvedValue({ units: [{ id: "org", name: "Office", projectFlow: { nodes: [{ id: "project", title: "MSO", status: "active", summary: "Context", projectRef: project.id }], edges: [] } }] });
  mocks.discovery.mockResolvedValue({ graphs: [{ id: "graph", owner: "a".repeat(64), name: "Saved workflow", status: "draft", nodeCount: 2, originPrincipal: "mcp-client:one", project: project.path }], scan: { warnings: [], ownersScanned: 1, totalOwners: 1 } });
  mocks.recipes.mockResolvedValue([{ id: "recipe", actor: "mcp-client:one", intent: "Saved recipe", successes: 1, attempts: 1, project: project.path }]);
  mocks.memory.mockResolvedValue({ records: [{ record: { id: "private", key: "workflow:key", kind: "procedural", document: "MEMORY.md", sensitivity: "private", value: "DO NOT EXPOSE PRIVATE VALUE" } }] });
});
describe("owner second-brain source projection", () => {
  it("refuses nonowners before reading workspace sources", async () => { await expect(workspaceSources("operator", "web:test", [], false)).rejects.toThrow("owner_required"); expect(mocks.chart).not.toHaveBeenCalled(); });
  it("links exact project references and withholds private agent values", async () => {
    const result = await workspaceSources("owner", "web:test", [project], false);
    expect(result.links.some(link => link.targetId === `project:${project.id}`)).toBe(true);
    expect(result.nodes.some(node => node.targetApp === "organization")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("DO NOT EXPOSE PRIVATE VALUE");
  });
  it("does not mix unscoped actor memories into a selected project and reports truncation", async () => {
    mocks.discovery.mockResolvedValue({ graphs: [], scan: { warnings: [], nextOwnerOffset: 4, totalOwners: 8, ownersScanned: 4 } });
    const result = await workspaceSources("owner", "web:test", [project], true);
    expect(mocks.memory).not.toHaveBeenCalled(); expect(result.truncated).toBe(true);
  });
});
