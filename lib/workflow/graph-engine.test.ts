import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CapabilityTool } from "@/lib/capabilities/tool";

vi.mock("@/lib/capabilities/execute", () => ({ executeCapabilityCall: async ({ tool, args, context }: { tool: CapabilityTool; args: Record<string, unknown>; context: never }) => {
  try { return { kind: "success", result: await tool.run(args, context) }; } catch (error) { return { kind: "error", message: error instanceof Error ? error.message : String(error) }; }
} }));
const dir = await mkdtemp(path.join(os.tmpdir(), "mso-graph-engine-"));
process.env.OS_AGENT_SESSIONS_DIR = dir;
const { createWorkflowGraph } = await import("./graph-store");
const { startWorkflowGraph, workflowGraphRunStatus } = await import("./graph-engine");
const context = { principal: "graph-owner", sessionId: "session", scope: "exec" as const, actor: "graph-owner" };
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("workflow graph engine", () => {
  it("routes a condition branch and marks the other branch skipped", async () => {
    const graph = await createWorkflowGraph("graph-owner", { name: "Branch", description: "", status: "draft", inputs: {}, metadata: {}, nodes: [
      { id: "start", name: "Start", type: "manual", position: { x: 0, y: 0 }, config: {} },
      { id: "check", name: "Check", type: "condition", position: { x: 100, y: 0 }, config: { path: "input.ok" } },
      { id: "yes", name: "Yes", type: "output", position: { x: 200, y: 0 }, config: { value: "yes" } },
      { id: "no", name: "No", type: "output", position: { x: 200, y: 100 }, config: { value: "no" } },
    ], edges: [
      { id: "a", source: "start", target: "check" }, { id: "b", source: "check", target: "yes", sourceHandle: "true" }, { id: "c", source: "check", target: "no", sourceHandle: "false" },
    ] });
    const started = await startWorkflowGraph(graph, { ok: true }, "branch-once", context, () => undefined);
    const done = await workflowGraphRunStatus("graph-owner", started.id, 5000);
    expect(done.state).toBe("completed");
    expect(done.nodes.find((node) => node.id === "yes")?.state).toBe("completed");
    expect(done.nodes.find((node) => node.id === "no")?.state).toBe("skipped");
  });
  it("pinpoints the failed node and blocks downstream nodes", async () => {
    const graph = await createWorkflowGraph("graph-owner", { name: "Failure", description: "", status: "draft", inputs: {}, metadata: {}, nodes: [
      { id: "start2", name: "Start", type: "manual", position: { x: 0, y: 0 }, config: {} },
      { id: "bad", name: "Broken tool", type: "tool", position: { x: 100, y: 0 }, config: { tool: "fixture_fail", arguments: {} } },
      { id: "after", name: "After", type: "output", position: { x: 200, y: 0 }, config: {} },
    ], edges: [{ id: "d", source: "start2", target: "bad" }, { id: "e", source: "bad", target: "after" }] });
    const tool: CapabilityTool = { name: "fixture_fail", description: "fixture", scope: "exec", inputSchema: { type: "object", properties: {} }, run: async () => { throw new Error("fixture exploded"); } };
    const started = await startWorkflowGraph(graph, {}, "fail-once", context, (name) => name === tool.name ? tool : undefined);
    const done = await workflowGraphRunStatus("graph-owner", started.id, 5000);
    expect(done.state).toBe("failed"); expect(done.failedNodeId).toBe("bad"); expect(done.failedNodeName).toBe("Broken tool");
    expect(done.nodes.find((node) => node.id === "after")?.state).toBe("blocked");
    expect(done.nodes.find((node) => node.id === "bad")?.logs.join(" ")).toContain("fixture exploded");
  });
  it("keeps run receipts private to the principal", async () => {
    await expect(workflowGraphRunStatus("another-owner", "0".repeat(32))).rejects.toThrow("not found");
  });
});
