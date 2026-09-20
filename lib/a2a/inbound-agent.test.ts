import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(async () => ({
    kind: "openai",
    provider: "test",
    model: "test",
  })),
  stream: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/lib/ai/selected-model-stream", () => ({
  prepareSelectedModel: mocks.prepare,
  streamPreparedSelectedModel: mocks.stream,
}));
const capabilities = {
  list: vi.fn(() => [
    { name: "sys_stats", description: "bounded read", scope: "read" as const, inputSchema: { type: "object" as const, properties: {} } },
    { name: "agent_memory_read", description: "owner memory", scope: "read" as const, inputSchema: { type: "object" as const, properties: {} } },
    { name: "exec_run", description: "host exec", scope: "exec" as const, inputSchema: { type: "object" as const, properties: {} } },
  ]),
  invoke: mocks.invoke,
};

const { runInboundA2AAgent } = await import("./inbound-agent");

describe("inbound A2A model boundary", () => {
  it("hides owner memory and higher-scope tools while isolating workflows by task session", async () => {
    let turn = 0;
    mocks.stream.mockImplementation(async ({ tools, system, emit }) => {
      expect(tools.map((tool: { name: string }) => tool.name)).toEqual([
        "sys_stats",
      ]);
      expect(system).toContain("NO owner memory");
      if (turn++ === 0) {
        emit("tool_use", { id: "call-1", name: "sys_stats", input: {} });
      } else {
        emit("delta", "done");
      }
    });
    mocks.invoke.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });

    const result = await runInboundA2AAgent({
      prompt: "inspect",
      scope: "read",
      principal: "a2a:in-peer",
      taskId: "task-123",
      signal: new AbortController().signal,
      capabilities,
    });

    expect(result.text).toBe("done");
    expect(mocks.invoke).toHaveBeenCalledWith({
      name: "sys_stats",
      args: {},
      scope: "read",
      actor: "a2a:in-peer",
      principal: "a2a:in-peer",
      sessionId: "task-123",
    });
  });

  it("locks standby delegation to the supplied workflow context and hides lifecycle controls", async () => {
    const fixedCapabilities = {
      list: vi.fn(() => [
        { name: "project_get", description: "project read", scope: "read" as const, inputSchema: { type: "object" as const, properties: { workflow_id: { type: "string" } } } },
        { name: "workflow_start", description: "start", scope: "write" as const, inputSchema: { type: "object" as const, properties: {} } },
        { name: "workflow_finish", description: "finish", scope: "write" as const, inputSchema: { type: "object" as const, properties: { workflow_id: { type: "string" } } } },
        { name: "local_agent_standby", description: "standby", scope: "exec" as const, inputSchema: { type: "object" as const, properties: { workflow_id: { type: "string" } } } },
      ]),
      invoke: vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }] })),
    };
    let turn = 0;
    mocks.stream.mockImplementation(async ({ tools, emit }) => {
      expect(tools.map((tool: { name: string }) => tool.name)).toEqual(["project_get"]);
      if (turn++ === 0)
        emit("tool_use", { id: "call-fixed", name: "project_get", input: {} });
      else emit("delta", "fixed done");
    });
    const executionContext = {
      workflowId: "33333333-3333-4333-8333-333333333333",
      workflowActor: "mcp:standby-owner",
      fixedWorkflow: true,
    };
    const result = await runInboundA2AAgent({
      prompt: "continue",
      scope: "exec",
      principal: "a2a:local:session",
      taskId: "task-fixed",
      signal: new AbortController().signal,
      capabilities: fixedCapabilities,
      executionContext,
    });
    expect(result.text).toBe("fixed done");
    expect(fixedCapabilities.invoke).toHaveBeenCalledWith({
      name: "project_get",
      args: {},
      scope: "exec",
      actor: "a2a:local:session",
      principal: "a2a:local:session",
      sessionId: "task-fixed",
      workflowId: executionContext.workflowId,
      workflowActor: executionContext.workflowActor,
    });
  });
});
