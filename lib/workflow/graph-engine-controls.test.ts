import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CapabilityTool } from "@/lib/capabilities/tool";

vi.mock("@/lib/capabilities/execute", () => ({ executeCapabilityCall: async ({ tool, args, context }: { tool: CapabilityTool; args: Record<string, unknown>; context: never }) => {
  try { return { kind: "success", result: await tool.run(args, context) }; }
  catch (error) { return { kind: "error", message: error instanceof Error ? error.message : String(error) }; }
} }));

const dir = await mkdtemp(path.join(os.tmpdir(), "mso-graph-controls-"));
process.env.OS_AGENT_SESSIONS_DIR = dir;
const { createWorkflowGraph } = await import("./graph-store");
const { requestWorkflowGraphStop, startWorkflowGraph, workflowGraphRunStatus } = await import("./graph-engine");
const tables = await import("./data-table-store");
const context = { principal: "controls-owner", sessionId: "session", scope: "exec" as const, actor: "controls-owner" };
afterAll(async () => { delete process.env.OS_AGENT_SESSIONS_DIR; await rm(dir, { recursive: true, force: true }); });

describe("workflow execution controls and data tables", () => {
  it("stops after the current bounded action and skips remaining nodes", async () => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const graph = await createWorkflowGraph("controls-owner", { name: "Stop run", description: "", status: "draft", inputs: {}, metadata: {}, nodes: [
      { id: "start", name: "Start", type: "manual", position: { x: 0, y: 0 }, config: {} },
      { id: "tool", name: "Long tool", type: "tool", position: { x: 100, y: 0 }, config: { tool: "fixture_block", arguments: {} } },
      { id: "out", name: "After stop", type: "output", position: { x: 200, y: 0 }, config: { value: "should-not-run" } },
    ], edges: [{ id: "e1", source: "start", target: "tool" }, { id: "e2", source: "tool", target: "out" }] });
    const tool: CapabilityTool = { name: "fixture_block", description: "fixture", scope: "exec", inputSchema: { type: "object", properties: {} }, run: async () => { enter(); await blocked; return { ok: true }; } };
    const started = await startWorkflowGraph(graph, { token: "private-input" }, "stop-run-once", context, (name) => name === tool.name ? tool : undefined);
    await entered;
    expect(await requestWorkflowGraphStop("controls-owner", started.id)).toMatchObject({ state: "running", stopRequested: true });
    release();
    const done = await workflowGraphRunStatus("controls-owner", started.id, 5000);
    expect(done.state).toBe("interrupted");
    expect(done.nodes.find((node) => node.id === "out")?.state).toBe("skipped");
    expect(JSON.stringify(done)).not.toContain("private-input");
  });

  it("mutates and reads persistent data tables through data_table nodes", async () => {
    const table = await tables.createWorkflowDataTable("controls-owner", "People", ["name"]);
    const graph = await createWorkflowGraph("controls-owner", { name: "Data table", description: "", status: "draft", inputs: {}, metadata: {}, nodes: [
      { id: "start-dt", name: "Start", type: "manual", position: { x: 0, y: 0 }, config: {} },
      { id: "insert", name: "Insert", type: "data_table", position: { x: 120, y: 0 }, config: { mode: "insert", tableId: table.id, values: { name: "Ada" } } },
      { id: "read", name: "Read", type: "data_table", position: { x: 240, y: 0 }, config: { mode: "get", tableId: table.id } },
      { id: "out-dt", name: "Out", type: "output", position: { x: 360, y: 0 }, config: { value: { "$ref": "nodes.read.output.rows" } } },
    ], edges: [{ id: "d1", source: "start-dt", target: "insert" }, { id: "d2", source: "insert", target: "read" }, { id: "d3", source: "read", target: "out-dt" }] });
    const started = await startWorkflowGraph(graph, {}, "data-table-node", context, () => undefined);
    const done = await workflowGraphRunStatus("controls-owner", started.id, 5000);
    expect(done.state).toBe("completed");
    expect((await tables.getWorkflowDataTable("controls-owner", table.id)).rows[0]?.values.name).toBe("Ada");
    expect(done.nodes.find((node) => node.id === "read")?.output).toMatchObject({ name: "People" });
  });
});
