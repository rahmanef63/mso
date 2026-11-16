import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ inventory: vi.fn(async () => ({ accounts: [], complete: true, nextCursor: null })), isolated: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/infra/composio-inventory", () => ({ queryComposioInventory: state.inventory }));
vi.mock("@/lib/host/audit-api", () => ({ audit: vi.fn() }));
vi.mock("@/lib/host/fs-api", () => ({ withIsolatedFilesystem: <T>(root: string | undefined, fn: () => Promise<T>, options: unknown) => { state.isolated(root, options); return fn(); } }));
vi.mock("@/lib/agent/session-store", () => ({ maybeAutoTitleAgentSession: vi.fn(async () => undefined) }));
vi.mock("@/lib/agent/local-agent-presence", () => ({ touchLocalAgentPresence: vi.fn(async () => undefined) }));
vi.mock("@/lib/workflow", () => ({
  activeWorkflowForActor: vi.fn(async () => ({ id: "flow-test", orchestration: { isolation: "isolated-worktree" } })),
  recordWorkflowStep: vi.fn(async () => undefined), replayHandlesFromResult: vi.fn(() => []),
}));
vi.mock("@/lib/capabilities/activity", async original => ({
  ...(await original<typeof import("@/lib/capabilities/activity")>()), recordCapabilityActivity: vi.fn(async () => undefined),
}));
vi.mock("@/lib/tenancy/capability", () => ({ tenantCapabilityPlan: vi.fn(async () => null) }));
import { executeCapabilityCall } from "@/lib/capabilities/execute";
import { INTEGRATION_TOOLS } from "@/lib/mcp/tools-integrations";
const args = { view: "broker", user: "owner", provider: "composio", connection: "study", workflow_id: "flow-test" };
beforeEach(() => { state.inventory.mockClear(); state.isolated.mockClear(); });
it("allows bounded broker metadata through the read capability without a source workspace", async () => {
  const tool = INTEGRATION_TOOLS.find(tool => tool.name === "integration_query")!;
  expect(tool.scope).toBe("read");
  const result = await executeCapabilityCall({ tool, args, scope: "read", actor: "inventory-reader" });
  expect(result).toMatchObject({ kind: "success", result: { result: { accounts: [], complete: true } } });
  expect(state.inventory).toHaveBeenCalledExactlyOnceWith({ view: "broker", user: "owner", provider: "composio", connection: "study" });
  expect(state.isolated).toHaveBeenCalledWith(undefined, { readOnly: true });
});
it("keeps exec-scope integration actions unavailable to a read token", async () => {
  const tool = INTEGRATION_TOOLS.find(tool => tool.name === "integration_execute")!;
  const result = await executeCapabilityCall({ tool, args: { ...args, operation: "route" }, scope: "read", actor: "inventory-denied" });
  expect(result.kind).toBe("error");
  expect(state.inventory).not.toHaveBeenCalled();
});
it("keeps provider mutations blocked when an exec workflow has no verified source workspace", async () => {
  const original = INTEGRATION_TOOLS.find(tool => tool.name === "integration_execute")!;
  const run = vi.fn(async () => ({}));
  const result = await executeCapabilityCall({ tool: { ...original, run }, args: { user: "owner", provider: "convex", connection: "study", operation: "convex.canonical.set", workflow_id: "flow-test" }, scope: "exec", actor: "inventory-mutator" });
  expect(result).toMatchObject({ kind: "error", message: expect.stringContaining("no verified workspace") });
  expect(run).not.toHaveBeenCalled();
});
