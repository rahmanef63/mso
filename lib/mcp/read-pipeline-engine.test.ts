import { describe, expect, it } from "vitest";
import { mcpDirect, type McpTool } from "./tool-kit";
import { runReadPipeline } from "./read-pipeline-engine";

const readTool = (name: string, run: McpTool["run"], limit?: McpTool["limit"]): McpTool => ({
  name, description: name, scope: "read", annotations: { readOnlyHint: true, idempotentHint: true },
  inputSchema: { type: "object", properties: {} }, ...(limit ? { limit } : {}), run,
});
const mutateTool = (name: string): McpTool => ({
  name, description: name, scope: "write", inputSchema: { type: "object", properties: {} }, run: async () => ({ changed: true }),
});
const resolver = (tools: McpTool[]) => { const map = new Map(tools.map((tool) => [tool.name, tool])); return (name: string) => map.get(name); };

const inventory = readTool("inventory", async () => ({ items: [
  { name: "api", status: "up", cpu: 25, team: "a" },
  { name: "web", status: "up", cpu: 8, team: "b" },
  { name: "jobs", status: "down", cpu: 1, team: "a" },
  { name: "worker", status: "up", cpu: 17, team: "a" },
] }));

describe("read_pipeline engine", () => {
  it("filters, sorts, limits and projects raw results before returning them", async () => {
    const out = await runReadPipeline({ calls: [{ id: "healthy", tool: "inventory", transform: {
      path: "items", where: [{ field: "status", op: "eq", value: "up" }], sort: { field: "cpu", direction: "desc" },
      limit: 2, select: ["name", "cpu"],
    } }] }, { scope: "read", actor: "pipeline:test-1" }, resolver([inventory]));
    expect(out.results.healthy).toEqual([{ name: "api", cpu: 25 }, { name: "worker", cpu: 17 }]);
    expect(out.metrics.callCount).toBe(1);
    expect(out.evidence[0]).toMatchObject({ id: "healthy", tool: "inventory", ok: true });
  });

  it("supports deterministic declarative aggregation", async () => {
    const out = await runReadPipeline({ calls: [{ id: "cpu", tool: "inventory", transform: {
      path: "items", where: [{ field: "team", op: "eq", value: "a" }], aggregate: { op: "avg", field: "cpu" },
    } }] }, { scope: "read", actor: "pipeline:test-2" }, resolver([inventory]));
    expect(out.results.cpu).toEqual({ op: "avg", field: "cpu", value: 43 / 3, count: 3 });
  });

  it("keeps declaration order even when parallel calls finish out of order", async () => {
    const slow = readTool("slow", async () => { await new Promise((r) => setTimeout(r, 25)); return { value: "slow" }; });
    const fast = readTool("fast", async () => ({ value: "fast" }));
    const out = await runReadPipeline({ calls: [{ id: "first", tool: "slow" }, { id: "second", tool: "fast" }] },
      { scope: "read", actor: "pipeline:test-3" }, resolver([slow, fast]));
    expect(Object.keys(out.results)).toEqual(["first", "second"]);
    expect(out.evidence.map((row) => row.id)).toEqual(["first", "second"]);
  });

  it("refuses write tools, nested pipelines, direct image results and child workflow ids", async () => {
    const nested = readTool("read_pipeline", async () => ({ nope: true }));
    const image = readTool("visual", async () => mcpDirect([{ type: "image", data: "AA==", mimeType: "image/png" }]));
    await expect(runReadPipeline({ calls: [{ id: "bad", tool: "write", arguments: {} }] }, { scope: "exec", actor: "pipeline:test-4" }, resolver([mutateTool("write")]))).rejects.toThrow(/read-only/);
    await expect(runReadPipeline({ calls: [{ id: "bad", tool: "read_pipeline" }] }, { scope: "read", actor: "pipeline:test-5" }, resolver([nested]))).rejects.toThrow(/read-only/);
    await expect(runReadPipeline({ calls: [{ id: "bad", tool: "visual" }] }, { scope: "read", actor: "pipeline:test-6" }, resolver([image]))).rejects.toThrow(/direct image\/file/);
    await expect(runReadPipeline({ calls: [{ id: "bad", tool: "inventory", arguments: { workflow_id: "other" } }] }, { scope: "read", actor: "pipeline:test-7" }, resolver([inventory]))).rejects.toThrow(/child workflow_id is forbidden/);
  });

  it("preserves the child tool's own rate limit", async () => {
    const limited = readTool("limited", async () => ({ ok: true }), { key: "pipeline-test-limit", max: 1, windowMs: 60_000 });
    const out = await runReadPipeline({ mode: "sequential", continueOnError: true, calls: [
      { id: "one", tool: "limited" }, { id: "two", tool: "limited" },
    ] }, { scope: "read", actor: "pipeline:unique-rate-limit" }, resolver([limited]));
    expect(out.evidence.map((row) => row.ok)).toEqual([true, false]);
    expect((out.results.two as { error: string }).error).toMatch(/rate limited/);
  });

  it("fails closed by default but can explicitly collect bounded read errors", async () => {
    const broken = readTool("broken", async () => { throw new Error("read failed"); });
    await expect(runReadPipeline({ calls: [{ id: "x", tool: "broken" }] }, { scope: "read", actor: "pipeline:test-8" }, resolver([broken]))).rejects.toThrow("read failed");
    const out = await runReadPipeline({ continueOnError: true, calls: [{ id: "x", tool: "broken" }, { id: "y", tool: "inventory" }] },
      { scope: "read", actor: "pipeline:test-9" }, resolver([broken, inventory]));
    expect(out.ok).toBe(false); expect(out.evidence.map((row) => row.ok)).toEqual([false, true]);
  });
  it("rejects prototype traversal and never executes child reads above read scope", async () => {
    let seenScope = "";
    const scoped = readTool("scoped", async (_a, context) => { seenScope = context.scope; return { safe: { value: 1 } }; });
    await runReadPipeline({ calls: [{ id: "safe", tool: "scoped" }] }, { scope: "exec", actor: "pipeline:test-scope" }, resolver([scoped]));
    expect(seenScope).toBe("read");
    await expect(runReadPipeline({ calls: [{ id: "bad", tool: "scoped", transform: { path: "constructor.name" } }] },
      { scope: "read", actor: "pipeline:test-proto" }, resolver([scoped]))).rejects.toThrow(/forbidden field segment/);
  });

  it("bounds total response wall time even when an eligible read does not finish promptly", async () => {
    const slow = readTool("very_slow", async () => { await new Promise((r) => setTimeout(r, 40)); return { late: true }; });
    await expect(runReadPipeline({ mode: "sequential", calls: [{ id: "late", tool: "very_slow" }] },
      { scope: "read", actor: "pipeline:test-deadline" }, resolver([slow]), 8)).rejects.toThrow(/wall-time budget/);
  });

});
