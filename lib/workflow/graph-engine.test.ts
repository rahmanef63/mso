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
    expect(done.edges?.find((edge) => edge.id === "b")?.state).toBe("enabled");
    expect(done.edges?.find((edge) => edge.id === "c")?.state).toBe("disabled");
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
    expect(done.edges?.find((edge) => edge.id === "e")?.state).toBe("pending");
    expect(done.nodes.find((node) => node.id === "bad")?.logs.join(" ")).toContain("fixture exploded");
  });
  it("keeps run receipts private to the principal", async () => {
    await expect(workflowGraphRunStatus("another-owner", "0".repeat(32))).rejects.toThrow("not found");
  });

  it("retries a bounded action and records attempts", async () => {
    let calls = 0;
    const graph = await createWorkflowGraph("graph-owner", { name: "Retry", description: "", status: "draft", inputs: {}, metadata: {}, nodes: [
      { id: "start3", name: "Start", type: "manual", position: { x: 0, y: 0 }, config: {} },
      { id: "retry", name: "Retry tool", type: "tool", position: { x: 100, y: 0 }, config: { tool: "fixture_retry", arguments: {}, retry: { maxAttempts: 3, backoffMs: 0 } } },
      { id: "after3", name: "After", type: "output", position: { x: 200, y: 0 }, config: {} },
    ], edges: [{ id: "r1", source: "start3", target: "retry" }, { id: "r2", source: "retry", target: "after3" }] });
    const tool: CapabilityTool = { name: "fixture_retry", description: "fixture", scope: "exec", inputSchema: { type: "object", properties: {} }, run: async () => { calls += 1; if (calls < 3) throw new Error("retry me"); return { ok: true }; } };
    const started = await startWorkflowGraph(graph, {}, "retry-once", context, (name) => name === tool.name ? tool : undefined);
    const done = await workflowGraphRunStatus("graph-owner", started.id, 5000);
    expect(done.state).toBe("completed"); expect(calls).toBe(3); expect(done.nodes.find((node) => node.id === "retry")?.attempts).toBe(3);
  });
  it("routes an action failure into an explicit error branch", async () => {
    const graph = await createWorkflowGraph("graph-owner", { name: "Handled", description: "", status: "draft", inputs: {}, metadata: {}, nodes: [
      { id: "start4", name: "Start", type: "manual", position: { x: 0, y: 0 }, config: {} },
      { id: "bad4", name: "Expected failure", type: "tool", position: { x: 100, y: 0 }, config: { tool: "fixture_error", arguments: {} } },
      { id: "handled", name: "Handled", type: "output", position: { x: 200, y: 0 }, config: { value: { handled: true } } },
    ], edges: [{ id: "h1", source: "start4", target: "bad4" }, { id: "h2", source: "bad4", target: "handled", sourceHandle: "error" }] });
    const tool: CapabilityTool = { name: "fixture_error", description: "fixture", scope: "exec", inputSchema: { type: "object", properties: {} }, run: async () => { throw new Error("expected failure"); } };
    const started = await startWorkflowGraph(graph, {}, "handled-once", context, (name) => name === tool.name ? tool : undefined);
    const done = await workflowGraphRunStatus("graph-owner", started.id, 5000);
    expect(done.state).toBe("completed_with_errors"); expect(done.nodes.find((node) => node.id === "bad4")?.state).toBe("failed"); expect(done.nodes.find((node) => node.id === "handled")?.state).toBe("completed");
  });
  it("redacts private secret variable values from receipts", async () => {
    const { setWorkflowVariable } = await import("./variables"); await setWorkflowVariable("graph-owner", "API_TOKEN", "top-secret-value", true);
    const graph = await createWorkflowGraph("graph-owner", { name: "Secret", description: "", status: "draft", inputs: {}, metadata: {}, nodes: [
      { id: "start5", name: "Start", type: "manual", position: { x: 0, y: 0 }, config: {} },
      { id: "echo", name: "Echo", type: "tool", position: { x: 100, y: 0 }, config: { tool: "fixture_echo", arguments: { value: { $var: "API_TOKEN" } } } },
    ], edges: [{ id: "s1", source: "start5", target: "echo" }] });
    const tool: CapabilityTool = { name: "fixture_echo", description: "fixture", scope: "exec", inputSchema: { type: "object", properties: {} }, run: async (args) => args };
    const started = await startWorkflowGraph(graph, {}, "secret-once", context, (name) => name === tool.name ? tool : undefined);
    const done = await workflowGraphRunStatus("graph-owner", started.id, 5000), receipt = JSON.stringify(done);
    expect(receipt).not.toContain("top-secret-value"); expect(receipt).toContain("[REDACTED]");
  });

  it("runs another workflow graph as a reusable subflow and blocks recursion", async () => {
    const child = await createWorkflowGraph("graph-owner", { name: "Child", description: "", status: "draft", inputs: {}, metadata: {}, nodes: [
      { id: "child-start", name: "Start", type: "manual", position: { x: 0, y: 0 }, config: {} },
      { id: "child-out", name: "Out", type: "output", position: { x: 120, y: 0 }, config: { value: { child: true } } },
    ], edges: [{ id: "child-e", source: "child-start", target: "child-out" }] });
    let parent = await createWorkflowGraph("graph-owner", { name: "Parent", description: "", status: "draft", inputs: {}, metadata: {}, nodes: [
      { id: "parent-start", name: "Start", type: "manual", position: { x: 0, y: 0 }, config: {} },
      { id: "child", name: "Child", type: "subflow", position: { x: 120, y: 0 }, config: { workflowId: child.id } },
      { id: "parent-out", name: "Out", type: "output", position: { x: 240, y: 0 }, config: {} },
    ], edges: [{ id: "parent-e1", source: "parent-start", target: "child" }, { id: "parent-e2", source: "child", target: "parent-out" }] });
    const started = await startWorkflowGraph(parent, {}, "subflow-once", context, () => undefined), done = await workflowGraphRunStatus("graph-owner", started.id, 5000);
    expect(done.state).toBe("completed"); expect(done.nodes.find((node) => node.id === "child")?.state).toBe("completed");
    const { version: _v, createdAt: _c, updatedAt: _u, revision: _r, ...definition } = parent;
    definition.nodes = definition.nodes.map((node) => node.id === "child" ? { ...node, config: { workflowId: parent.id } } : node);
    parent = await (await import("./graph-store")).updateWorkflowGraph("graph-owner", parent.id, parent.revision, definition);
    const recursive = await startWorkflowGraph(parent, {}, "subflow-recursive", context, () => undefined), recursiveDone = await workflowGraphRunStatus("graph-owner", recursive.id, 5000);
    expect(recursiveDone.state).toBe("failed"); expect(recursiveDone.nodes.find((node) => node.id === "child")?.error).toContain("recursive");
  });
  it("accepts secret-shaped runtime input but redacts it from persisted trigger receipts", async () => {
    const graph = await createWorkflowGraph("graph-owner", { name: "Runtime input", description: "", status: "draft", inputs: {}, metadata: {}, nodes: [
      { id: "start-runtime", name: "Webhook", type: "webhook", position: { x: 0, y: 0 }, config: {} },
      { id: "runtime-out", name: "Out", type: "output", position: { x: 100, y: 0 }, config: { value: { ok: true } } },
    ], edges: [{ id: "runtime-e", source: "start-runtime", target: "runtime-out" }] });
    const started = await startWorkflowGraph(graph, { headers: { authorization: "Bearer abc" }, body: { token: "incoming-token", safe: "visible" } }, "runtime-secret-input", context, () => undefined, "graph-owner", { type: "webhook", nodeId: "start-runtime", receivedAt: new Date().toISOString() });
    const done = await workflowGraphRunStatus("graph-owner", started.id, 5000), receipt = JSON.stringify(done);
    expect(done.state).toBe("completed");
    expect(receipt).not.toContain("Bearer abc"); expect(receipt).not.toContain("incoming-token"); expect(receipt).toContain("[REDACTED]"); expect(receipt).toContain("visible");
  });

});
