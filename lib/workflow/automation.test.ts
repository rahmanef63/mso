import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { CapabilityTool } from "@/lib/capabilities/tool";
vi.mock("@/lib/capabilities/execute", () => ({ executeCapabilityCall: async ({ tool, args, context }: { tool: CapabilityTool; args: Record<string, unknown>; context: never }) => {
  try { return { kind: "success", result: await tool.run(args, context) }; } catch (e) { return { kind: "error", message: String(e) }; }
} }));
const directory = await mkdtemp(path.join(os.tmpdir(), "mso-flow-test-"));
process.env.OS_AGENT_SESSIONS_DIR = directory;
const { parseFlow, flowInputs, bindFlowValue } = await import("./automation-schema");
const { startFlow, flowStatus } = await import("./automation-engine");
const { readFlowRun, writeFlowRun, flowOwner } = await import("./automation-store");
const context = { principal: "test-flow-owner", sessionId: "test-session", scope: "exec" as const };
const flow = parseFlow({ id: "echo", description: "Echo two steps", inputs: { name: { type: "string", required: true, description: "Name" } }, steps: [
  { id: "first", tool: "project_mcp_call", arguments: { server: "fixture", tool: "echo", arguments: { name: { $ref: "input.name" } } } },
  { id: "second", tool: "project_mcp_call", arguments: { server: "fixture", tool: "echo", arguments: { previous: { $ref: "steps.first.echo" } } }, expect: { path: "ok", equals: true } },
] });
afterAll(() => rm(directory, { recursive: true, force: true }));

describe("reusable project flows", () => {
  it("runs ordered references once, binds project, rejects replay changes and isolates owners", async () => {
    const calls: Record<string, unknown>[] = [];
    const tool: CapabilityTool = { name: "project_mcp_call", scope: "exec", description: "fixture", inputSchema: { type: "object", properties: {} },
      run: async args => { calls.push(args); return { ok: true, echo: "hello" }; } };
    const first = await startFlow(flow, "project-a", { name: "hello" }, "once", context, () => tool);
    const done = await flowStatus(first.id, context, 5000);
    expect(done.state).toBe("completed"); expect(calls).toHaveLength(2);
    expect(calls[0].project).toBe("project-a"); expect(calls[1].arguments).toEqual({ previous: "hello" });
    expect((await startFlow(flow, "project-a", { name: "hello" }, "once", context, () => tool)).id).toBe(first.id);
    expect(calls).toHaveLength(2);
    await expect(startFlow(flow, "project-a", { name: "different" }, "once", context, () => tool)).rejects.toThrow("different flow");
    await expect(flowStatus(first.id, { ...context, principal: "another-owner" })).rejects.toThrow("not found");
  });
  it("stops after an error and retains the receipt across a simulated process exit", async () => {
    let calls = 0;
    const tool: CapabilityTool = { name: "project_mcp_call", scope: "exec", description: "fixture", inputSchema: { type: "object", properties: {} }, run: async () => { calls++; throw new Error("provider rejected"); } };
    const started = await startFlow(flow, "project-a", { name: "hello" }, "failure", context, () => tool);
    expect((await flowStatus(started.id, context, 5000)).state).toBe("failed"); expect(calls).toBe(1);
    const run = (await readFlowRun(flowOwner(context.principal), started.id))!;
    run.state = "running"; run.pid = 2147483647; run.instance = "old-process"; await writeFlowRun(run);
    expect((await flowStatus(started.id, context)).state).toBe("interrupted");
    expect(calls).toBe(1);
  });
  it("rejects missing inputs, raw shell, secret fields, prototype paths and insufficient grants", async () => {
    for (const wait of [-1, 25001, NaN, Infinity]) await expect(flowStatus("0".repeat(32), context, wait)).rejects.toThrow("wait_ms");
    expect(() => flowInputs(flow, {})).toThrow("missing input.name");
    expect(() => flowInputs(flow, { name: "a", token: "secret" })).toThrow("secret_input");
    expect(() => parseFlow({ ...flow, steps: [{ id: "bad", tool: "exec_run", arguments: { command: "echo x" } }] })).toThrow("invalid");
    expect(() => bindFlowValue({ $ref: "input.__proto__" }, { input: {} })).toThrow("invalid flow reference");
    await expect(startFlow(flow, "project-a", { name: "a" }, "denied", { ...context, allowedTools: ["flow_run"] }, () => ({ name: "project_mcp_call", scope: "exec" } as CapabilityTool))).rejects.toThrow("not permitted");
  });
});
